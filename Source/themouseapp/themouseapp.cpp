#include <interception.h>
#include "utils.h"
#include <iostream>
#include <chrono>
#include <random>
#include <string>
#include <vector>
#include <cmath>
#include <ctime>
#include <fstream>
#include <windows.h>
#include <armadillo>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <deque>
#include <algorithm>
#include <cstdint>
#include <cstdio>

#pragma warning(disable : 4996)

using namespace std;
using namespace arma;

// ---- Settings (globals) ----
int    SMOOTH_AMT  = 2;
int    PAUSE_KEY   = 0;
double MAX_SENS    = 2.0,  MIN_SENS       = 0.5;
double SENS_MEAN   = 1.0,  SENS_SPREAD    = 0.6;
double X_RATIO     = 1.0,  Y_RATIO        = 1.0;
double TIMESTEP_MEAN = 0.2, TIMESTEP_STDDEV = 0.1;
double GAUSSIAN_STDDEV = 1000.0, GAUSSIAN_WINDOW_SIZE = 5000.0;
bool   DEBUG = false, TYPE = true;
bool   RANDOMIZER_ENABLED = false, XY_ENABLED = false;
bool   ANGLE_ENABLED      = false;
double ANGLE_VALUE        = 0.0;

// ---- Accel LUT (globals) ----
static const int ACCEL_LUT_SIZE = 512;
double ACCEL_LUT_X[ACCEL_LUT_SIZE];
double ACCEL_LUT_Y[ACCEL_LUT_SIZE];
double ACCEL_MAX_SPEED = 1500.0; // mm/s
bool   ACCEL_ENABLED   = false;
bool   ACCEL_MULTI     = false;
double MOUSE_DPI       = 800.0;

COORD  coord;
HANDLE hConsole = GetStdHandle(STD_OUTPUT_HANDLE);

// ---- Chunk streaming (smooth mode) ----
// 5-minute chunks; overlap absorbs smoothing-edge artifacts
const double CHUNK_SEC = 300.0;
const size_t MAX_BUF   = 3;

// ---- State (off the mouse hot path) ----
atomic<bool>   g_paused{false};

struct SensChunk {
    vector<double> t;  // timestamps relative to chunk start (seconds)
    vector<double> s;  // sensitivity multipliers
};

mutex              g_mtx;
condition_variable g_cv;
deque<SensChunk>   g_buf;
atomic<bool>       g_gen_done{false};

// ---- Command listener (from Electron) ----
void commandListenerThread()
{
    string cmd;
    while (cin >> cmd) {
        if (cmd == "PAUSE")        g_paused.store(true);
        else if (cmd == "RESUME")  g_paused.store(false);
        else if (cmd == "TOGGLE")  g_paused.store(!g_paused.load());
    }
}

// ---- Console setup ----
void setUp()
{
    CONSOLE_FONT_INFOEX cfi;
    cfi.cbSize     = sizeof cfi;
    cfi.nFont      = 0;
    cfi.dwFontSize.X = 0;
    cfi.dwFontSize.Y = 14;
    cfi.FontFamily = FF_DONTCARE;
    cfi.FontWeight = FW_NORMAL;
    wcscpy_s(cfi.FaceName, L"Consolas");
    SetCurrentConsoleFontEx(hConsole, FALSE, &cfi);

    coord.X = 80; coord.Y = 30;
    SetConsoleScreenBufferSize(hConsole, coord);
    SMALL_RECT r = {0, 0, (SHORT)(coord.X - 1), (SHORT)(coord.Y - 1)};
    SetConsoleWindowInfo(hConsole, TRUE, &r);

    SetConsoleTextAttribute(hConsole, 0x0f);
    printf("Sensitivity Randomizer \n======================\n");
    printf("By: Whisper & El Bad\n\n");
    SetConsoleTextAttribute(hConsole, 0x08);
}

// ---- Read settings.ini ----
bool readSettings(const string& path)
{
    printf("Attempting to open settings file: %s\n", path.c_str());
    bool garbage = false;

    ifstream file(path);
    if (!file.is_open()) {
        SetConsoleTextAttribute(hConsole, 0x04);
        printf("Cannot read settings file. Using defaults.\n");
        SetConsoleTextAttribute(hConsole, 0x08);
        return false;
    }

    SetConsoleTextAttribute(hConsole, 0x02);
    printf("Settings file found! Reading values. ");
    SetConsoleTextAttribute(hConsole, 0x08);

    string line;
    while (getline(file, line)) {
        if (line.empty() || line[0] == ';' || line[0] == '#') continue;
        size_t eq = line.find('=');
        if (eq == string::npos) continue;

        string name = line.substr(0, eq);
        string val_s = line.substr(eq + 1);
        
        // Trim
        name.erase(0, name.find_first_not_of(" \t\r\n"));
        if (name.find_last_not_of(" \t\r\n") != string::npos)
            name.erase(name.find_last_not_of(" \t\r\n") + 1);

        val_s.erase(0, val_s.find_first_not_of(" \t\r\n"));
        if (val_s.find_last_not_of(" \t\r\n") != string::npos)
            val_s.erase(val_s.find_last_not_of(" \t\r\n") + 1);

        try {
            double val = stod(val_s);
            if (DEBUG) printf("Loaded: %s = %.2f\n", name.c_str(), val);

            if      (name == "Smooth")               TYPE          = (bool)val;
            else if (name == "Baseline_Sensitivity") SENS_MEAN     = val;
            else if (name == "Min_Sensitivity")      MIN_SENS      = val;
            else if (name == "Max_Sensitivity")      MAX_SENS      = val;
            else if (name == "Spread")               SENS_SPREAD   = val;
            else if (name == "Smoothing")            SMOOTH_AMT    = (int)val;
            else if (name == "Timestep")             TIMESTEP_MEAN = val;
            else if (name == "Pause_Key")            PAUSE_KEY     = (int)val;
            else if (name == "Debug")                DEBUG         = (bool)val;
            else if (name == "X_Sensitivity")        X_RATIO            = val;
            else if (name == "Y_Sensitivity")        Y_RATIO            = val;
            else if (name == "Randomizer_Enabled")   RANDOMIZER_ENABLED = (bool)val;
            else if (name == "XY_Enabled")           XY_ENABLED         = (bool)val;
            else if (name == "Angle_Enabled")        ANGLE_ENABLED      = (bool)val;
            else if (name == "Angle_Value")          ANGLE_VALUE        = val;
            else if (name == "Mouse_DPI")            MOUSE_DPI          = val > 0 ? val : 800;
            else {
                if (DEBUG) printf("Unknown setting: %s\n", name.c_str());
                garbage = true;
            }
        } catch (...) { 
            if (DEBUG) printf("Error parsing value for: %s (value was '%s')\n", name.c_str(), val_s.c_str());
            garbage = true; 
        }
    }

    if (SENS_MEAN <= 0)           { SENS_MEAN    = 1;          garbage = true; }
    if (SENS_SPREAD <= 0)         { SENS_SPREAD  = 1e-7;       garbage = true; }
    if (SENS_MEAN < MIN_SENS)     { MIN_SENS     = SENS_MEAN / 2.0; garbage = true; }
    if (SENS_MEAN > MAX_SENS)     { MAX_SENS     = SENS_MEAN * 2.0; garbage = true; }
    if (SMOOTH_AMT < 0)           { SMOOTH_AMT   = 0;          garbage = true; }
    if (TIMESTEP_MEAN <= 0)       { TIMESTEP_MEAN = 0.2;       garbage = true; }
    if (TYPE != 0 && TYPE != 1)   { TYPE         = 1;          garbage = true; }

    if (TYPE == 1) { TIMESTEP_MEAN = 0.2; TIMESTEP_STDDEV = 0.1; }
    if (TYPE == 0) { TIMESTEP_STDDEV = TIMESTEP_MEAN / 10.0; }

    // Fixed: original was missing break statements, so every level fell through to 50000
    switch (SMOOTH_AMT) {
        case 0:  GAUSSIAN_STDDEV = 1;      break;
        case 1:  GAUSSIAN_STDDEV = 100;    break;
        case 2:  GAUSSIAN_STDDEV = 1000;   break;
        case 3:  GAUSSIAN_STDDEV = 5000;   break;
        case 4:  GAUSSIAN_STDDEV = 10000;  break;
        default: GAUSSIAN_STDDEV = 50000;  break;
    }

    return garbage;
}

// ---- Raw point generation (stateful random walk) ----
struct RawState {
    double time;
    double sens;
    default_random_engine gen;
};

// Append new (time, sens) pairs to xs/ys until xs.back() >= until_time
void rawGen(RawState& st, double until_time,
            vector<double>& xs, vector<double>& ys)
{
    while (st.time < until_time) {
        lognormal_distribution<double> sd(log(st.sens), SENS_SPREAD);
        double s;
        do { s = sd(st.gen); } while (s < MIN_SENS || s > MAX_SENS);
        st.sens = s;

        normal_distribution<double> td(TIMESTEP_MEAN, TIMESTEP_STDDEV);
        double dt;
        do { dt = td(st.gen); } while (dt <= 0);

        st.time += dt;
        xs.push_back(st.time);
        ys.push_back(s);
    }
}

// ---- Gaussian smoothing (returns absolute timestamps) ----
pair<vector<double>, vector<double>>
smoothAbs(vector<double>& xv, vector<double>& yv)
{
    size_t N = xv.size();
    vec xx = linspace<vec>(xv.front(), xv.back(), N * 200);
    vec yy;
    arma::interp1(vec(xv), vec(yv), xx, yy);

    vec n = linspace<vec>(0, GAUSSIAN_WINDOW_SIZE - 1, (uword)GAUSSIAN_WINDOW_SIZE)
            - (GAUSSIAN_WINDOW_SIZE - 1) / 2.0;
    vec w = exp(-square(n) / (2.0 * GAUSSIAN_STDDEV * GAUSSIAN_STDDEV));
    vec sc = conv(yy, w / sum(w), "same");

    vector<double> t = conv_to<vector<double>>::from(xx);
    vector<double> s = conv_to<vector<double>>::from(sc);

    int off = 4000;
    if ((int)t.size() <= 2 * off) off = 0;
    return {
        vector<double>(t.begin() + off, t.end() - off),
        vector<double>(s.begin() + off, s.end() - off)
    };
}

// Extract absolute range [lo, hi] and return as chunk with relative timestamps
SensChunk extractChunk(vector<double>& t, vector<double>& s, double lo, double hi)
{
    auto it_lo = lower_bound(t.begin(), t.end(), lo);
    auto it_hi = upper_bound(t.begin(), t.end(), hi);
    SensChunk c;
    size_t i0 = it_lo - t.begin(), i1 = it_hi - t.begin();
    c.t.assign(t.begin() + i0, t.begin() + i1);
    c.s.assign(s.begin() + i0, s.begin() + i1);
    for (double& tv : c.t) tv -= lo;
    return c;
}

// ---- Background generator thread (smooth mode) ----
// Produces overlapping-smoothed chunks into g_buf.
// overlap_seconds: raw data kept from each side so the Gaussian trim doesn't bite into the chunk.
// Trim eats ~20*TIMESTEP_MEAN seconds from each end, so overlap must exceed that.
void generatorThread(double start_sens, unsigned seed)
{
    RawState st;
    st.time = 0.0;
    st.sens = start_sens;
    st.gen.seed(seed);

    double overlap = max(8.0, 28.0 * TIMESTEP_MEAN);
    double chunk_lo = 0.0;

    // Artificial overlap before t=0 so the first chunk's left edge is clean
    vector<double> tail_x = {-overlap, 0.0};
    vector<double> tail_y = {start_sens, start_sens};

    for (;;) {
        // Block if buffer is full
        {
            unique_lock<mutex> lk(g_mtx);
            g_cv.wait(lk, [] { return g_buf.size() < MAX_BUF; });
        }

        double chunk_hi = chunk_lo + CHUNK_SEC;

        // Build raw data: saved tail + newly generated points
        vector<double> raw_x = tail_x;
        vector<double> raw_y = tail_y;
        rawGen(st, chunk_hi + overlap, raw_x, raw_y);

        if (raw_x.size() >= 2) {
            pair<vector<double>, vector<double>> sr = smoothAbs(raw_x, raw_y);
            vector<double>& abs_t = sr.first;
            vector<double>& abs_s = sr.second;
            SensChunk chunk;
            if (!abs_t.empty())
                chunk = extractChunk(abs_t, abs_s, chunk_lo, chunk_hi);

            if (!chunk.t.empty()) {
                lock_guard<mutex> lk(g_mtx);
                g_buf.push_back(move(chunk));
            }
        }
        g_cv.notify_one();

        // Save tail: raw points from (chunk_hi - overlap) onward for next iteration
        {
            double tail_lo = chunk_hi - overlap;
            tail_x.clear(); tail_y.clear();
            for (size_t i = 0; i < raw_x.size(); i++) {
                if (raw_x[i] >= tail_lo) {
                    tail_x.push_back(raw_x[i]);
                    tail_y.push_back(raw_y[i]);
                }
            }
            if (tail_x.empty()) {
                tail_x.push_back(raw_x.back());
                tail_y.push_back(raw_y.back());
            }
        }

        chunk_lo = chunk_hi;
    }

    g_gen_done = true;
    g_cv.notify_all();
}


// ---- Read accel LUT binary ----
// Format: uint32 flag (bit0:enabled, bit1:multi) | float32 maxSpeed | uint32 count | float32[count] lutX [ | float32[count] lutY ]
void readAccelLut(const string& path)
{
    for (int i = 0; i < ACCEL_LUT_SIZE; i++) {
        ACCEL_LUT_X[i] = 1.0;
        ACCEL_LUT_Y[i] = 1.0;
    }

    FILE* f = fopen(path.c_str(), "rb");
    if (!f) {
        printf("No accel LUT found (%s), acceleration disabled.\n", path.c_str());
        ACCEL_ENABLED = false;
        ACCEL_MULTI   = false;
        return;
    }

    uint32_t flag = 0, lut_count = 0;
    float    max_speed_f  = 50.0f;
    bool ok = fread(&flag, 4, 1, f) == 1
           && fread(&max_speed_f,  4, 1, f) == 1
           && fread(&lut_count,    4, 1, f) == 1;

    if (!ok) { fclose(f); ACCEL_ENABLED = false; ACCEL_MULTI = false; return; }

    ACCEL_ENABLED   = (flag & 1) != 0;
    ACCEL_MULTI     = (flag & 2) != 0;
    ACCEL_MAX_SPEED = (double)max_speed_f;

    uint32_t n = min(lut_count, (uint32_t)ACCEL_LUT_SIZE);
    
    // Read X LUT
    vector<float> tmpX(n);
    if (fread(tmpX.data(), 4, n, f) == n) {
        for (uint32_t i = 0; i < n; i++) ACCEL_LUT_X[i] = (double)tmpX[i];
    }
    // Pad X
    for (uint32_t i = n; i < (uint32_t)ACCEL_LUT_SIZE; i++)
        ACCEL_LUT_X[i] = n > 0 ? ACCEL_LUT_X[n - 1] : 1.0;

    if (ACCEL_MULTI) {
        // Read Y LUT
        vector<float> tmpY(n);
        if (fread(tmpY.data(), 4, n, f) == n) {
            for (uint32_t i = 0; i < n; i++) ACCEL_LUT_Y[i] = (double)tmpY[i];
        }
        // Pad Y
        for (uint32_t i = n; i < (uint32_t)ACCEL_LUT_SIZE; i++)
            ACCEL_LUT_Y[i] = n > 0 ? ACCEL_LUT_Y[n - 1] : 1.0;
    } else {
        // Copy X to Y
        for (uint32_t i = 0; i < ACCEL_LUT_SIZE; i++)
            ACCEL_LUT_Y[i] = ACCEL_LUT_X[i];
    }

    fclose(f);

    if (ACCEL_ENABLED)
        printf("Accel curve loaded: max %.1f mm/s, %u entries, multi=%d\n",
               ACCEL_MAX_SPEED, n, ACCEL_MULTI);
    else
        printf("Accel curve loaded but disabled.\n");
}

// ---- Main ----
int main(int argc, char* argv[])
{
    InterceptionContext context;
    InterceptionDevice  device;
    InterceptionStroke  stroke;

    string settingsPath = "settings.ini";
    if (argc > 1) {
        settingsPath = argv[1];
    }

    // Derive accel LUT path from settings directory
    string lutPath;
    {
        size_t slash = settingsPath.find_last_of("/\\");
        lutPath = (slash != string::npos)
                ? settingsPath.substr(0, slash + 1) + "accel_lut.bin"
                : "accel_lut.bin";
    }

    DWORD prev_mode;
    GetConsoleMode(hConsole, &prev_mode);
    SetConsoleMode(hConsole, prev_mode & ~ENABLE_QUICK_EDIT_MODE);

    raise_process_priority();
    context = interception_create_context();

    // --- Setup and read settings BEFORE touching the interception filter ---
    setUp();
    bool garbage = readSettings(settingsPath);
    readAccelLut(lutPath);

    // Print settings
    {
        const char* type_str = TYPE ? "1 (Smoothed)" : "0 (Step)";
        printf("\nYour settings are:\n");
        SetConsoleTextAttribute(hConsole, 0x02);
        printf("Type: %s\nBase Sensitivity: %.2f\nMin: %.2f\nMax: %.2f\n"
               "Spread: %.2f\nSmoothing: %d\nTimestep: %.1f s\nDebug: %d\n"
               "Randomizer Enabled: %d\nXY Enabled: %d\nX Sensitivity: %.2f\nY Sensitivity: %.2f\n"
               "Accel Enabled: %d\nAccel Multi: %d\nAccel Max Speed: %.0f mm/s\nMouse DPI: %.0f\n\n",
               type_str, SENS_MEAN, MIN_SENS, MAX_SENS,
               SENS_SPREAD, SMOOTH_AMT, TIMESTEP_MEAN, DEBUG,
               RANDOMIZER_ENABLED, XY_ENABLED, X_RATIO, Y_RATIO,
               ACCEL_ENABLED, ACCEL_MULTI, ACCEL_MAX_SPEED, MOUSE_DPI);
        SetConsoleTextAttribute(hConsole, 0x08);

        if (garbage) {
            SetConsoleTextAttribute(hConsole, 0x04);
            printf("Fixing errors!\n");
            SetConsoleTextAttribute(hConsole, 0x08);
        }
    }

    SetConsoleTextAttribute(hConsole, 0x4f);
    printf(" [CTRL+C] to QUIT ");
    SetConsoleTextAttribute(hConsole, 0x08);
    coord.X = 0; coord.Y = 21;
    SetConsoleCursorPosition(hConsole, coord);

    unsigned seed = (unsigned)chrono::system_clock::now().time_since_epoch().count();

    thread cmd_thread(commandListenerThread);
    cmd_thread.detach();

    // ---- Generate curve BEFORE setting up interception filter (fixes mouse freeze) ----
    // For step mode: pre-generate finite; infinite is on-demand in main loop.
    // For step mode: pre-generate finite; infinite is on-demand in main loop.
    // For smooth mode: background thread generates chunks; we wait for the first one.

    vector<double> step_t, step_s;  // used by step mode
    RawState step_st;               // on-demand state for infinite step mode

    if (RANDOMIZER_ENABLED) {
        if (TYPE == 0) {
            // Step mode
            step_t.push_back(0.0);
            step_s.push_back(SENS_MEAN);
            step_st.time = 0.0;
            step_st.sens = SENS_MEAN;
            step_st.gen.seed(seed);

            rawGen(step_st, TIMESTEP_MEAN * 20, step_t, step_s);
        } else {
            // Smooth mode: launch background thread, wait for first chunk
            printf("\nGenerating sensitivity curve...");
            thread bg(generatorThread, SENS_MEAN, seed);
            bg.detach();

            unique_lock<mutex> lk(g_mtx);
            g_cv.wait(lk, [] { return !g_buf.empty() || g_gen_done.load(); });
            printf(" Done.\n");
        }
    }

    // ---- NOW install interception filters (mouse no longer freezes) ----
    interception_set_filter(context, interception_is_mouse,
                            INTERCEPTION_FILTER_MOUSE_MOVE);
    if (PAUSE_KEY != 0)
        interception_set_filter(context, interception_is_keyboard,
                                INTERCEPTION_FILTER_KEY_DOWN | INTERCEPTION_FILTER_KEY_UP);

    typedef chrono::high_resolution_clock Clock;
    typedef chrono::duration<double>      DSec;

    auto   prog_start      = Clock::now();
    auto   last_live       = Clock::now();
    auto   last_event_time = Clock::now();
    double carryX = 0, carryY = 0;
    double sens_mult = RANDOMIZER_ENABLED ? SENS_MEAN : 1.0;
    ULONGLONG lastpress = 0;

    // Smooth mode tracking
    SensChunk cur_chunk;
    size_t    chunk_i         = 0;
    double    chunk_abs_start = 0.0;  // absolute seconds when current chunk began
    bool      have_chunk      = false;

    if (TYPE == 1) {
        unique_lock<mutex> lk(g_mtx);
        if (!g_buf.empty()) {
            cur_chunk  = move(g_buf.front());
            g_buf.pop_front();
            lk.unlock();
            g_cv.notify_one();
            have_chunk = true;
            if (!cur_chunk.s.empty()) sens_mult = cur_chunk.s.front();
        }
    }

    // Step mode tracking
    size_t step_i = 1;  // index of next waypoint in step_t/step_s

    if (XY_ENABLED) {
        printf("XY Decoupling Active: X=%.2f, Y=%.2f\n", X_RATIO, Y_RATIO);
    }

    printf("\nRunning...\n");

    while (interception_receive(context, device = interception_wait(context), &stroke, 1) > 0)
    {
        if (interception_is_mouse(device))
        {
            InterceptionMouseStroke& ms = *(InterceptionMouseStroke*)&stroke;

            if (!(ms.flags & INTERCEPTION_MOUSE_MOVE_ABSOLUTE))
            {
                auto now = Clock::now();
                double dt_ms = DSec(now - last_event_time).count() * 1000.0;
                last_event_time = now;
                if (dt_ms < 0.01)  dt_ms = 0.01;
                if (dt_ms > 100.0) dt_ms = 100.0; // treat idle gaps as low speed
                double t_abs = DSec(now - prog_start).count();
                bool paused = g_paused.load();

                // 0. Angle Correction (Rotation)
                if (ANGLE_ENABLED && ANGLE_VALUE != 0.0) {
                    static double rot_carryX = 0.0;
                    static double rot_carryY = 0.0;
                    double rad = ANGLE_VALUE * (3.14159265358979323846 / 180.0);
                    double cos_a = cos(rad);
                    double sin_a = sin(rad);

                    double rx = ms.x * cos_a - ms.y * sin_a + rot_carryX;
                    double ry = ms.x * sin_a + ms.y * cos_a + rot_carryY;

                    ms.x = (int)round(rx);
                    ms.y = (int)round(ry);

                    rot_carryX = rx - ms.x;
                    rot_carryY = ry - ms.y;
                }

                // 1. Determine base multiplier (Randomizer)
                double base_mult = 1.0;
                if (RANDOMIZER_ENABLED && !paused)
                {
                    if (TYPE == 0)
                    {
                        // ---- Step mode ----
                        while (step_t.back() <= t_abs + TIMESTEP_MEAN * 10)
                            rawGen(step_st, step_st.time + TIMESTEP_MEAN * 10,
                                   step_t, step_s);

                        while (step_i < step_t.size() && step_t[step_i] <= t_abs)
                            step_i++;

                        if (step_i > 0 && step_i <= step_t.size())
                            sens_mult = step_s[step_i - 1];
                    }
                    else
                    {
                        // ---- Smooth mode ----
                        if (have_chunk) {
                            double t_in = t_abs - chunk_abs_start;

                            // Advance within current chunk
                            while (chunk_i + 1 < cur_chunk.t.size() &&
                                   cur_chunk.t[chunk_i + 1] <= t_in)
                                chunk_i++;

                            if (!cur_chunk.s.empty())
                                sens_mult = cur_chunk.s[chunk_i];

                            // Move to next chunk when this one is spent.
                            bool exhausted = cur_chunk.t.empty()
                                          || t_in > cur_chunk.t.back()
                                          || t_in >= CHUNK_SEC;
                            if (exhausted) {
                                unique_lock<mutex> lk(g_mtx);
                                if (!g_buf.empty()) {
                                    chunk_abs_start += CHUNK_SEC;
                                    cur_chunk = move(g_buf.front());
                                    g_buf.pop_front();
                                    lk.unlock();
                                    g_cv.notify_one();
                                    chunk_i = 0;
                                } else {
                                    lk.unlock();
                                }
                            }
                        } else {
                            unique_lock<mutex> lk(g_mtx);
                            if (!g_buf.empty()) {
                                cur_chunk  = move(g_buf.front());
                                g_buf.pop_front();
                                lk.unlock();
                                g_cv.notify_one();
                                have_chunk = true;
                                chunk_i    = 0;
                            } else {
                                lk.unlock();
                            }
                        }
                    }
                    base_mult = sens_mult;
                }
                else
                {
                    base_mult = 1.0;
                }

                // 2. Accel curve lookup: speed in mm/s = counts/ms * 25400 / DPI
                double speed_x = abs((double)ms.x) * 25400.0 / (dt_ms * MOUSE_DPI);
                double speed_y = abs((double)ms.y) * 25400.0 / (dt_ms * MOUSE_DPI);
                double accel_mult_x = 1.0, accel_mult_y = 1.0;

                if (ACCEL_ENABLED) {
                    int idx_x = (int)(speed_x / ACCEL_MAX_SPEED * ACCEL_LUT_SIZE);
                    if (idx_x < 0) idx_x = 0;
                    if (idx_x >= ACCEL_LUT_SIZE) idx_x = ACCEL_LUT_SIZE - 1;
                    accel_mult_x = ACCEL_LUT_X[idx_x];

                    int idx_y = (int)(speed_y / ACCEL_MAX_SPEED * ACCEL_LUT_SIZE);
                    if (idx_y < 0) idx_y = 0;
                    if (idx_y >= ACCEL_LUT_SIZE) idx_y = ACCEL_LUT_SIZE - 1;
                    accel_mult_y = ACCEL_LUT_Y[idx_y];
                }

                // 3. Apply XY Ratios + accel
                double live_x = base_mult * accel_mult_x * (XY_ENABLED ? X_RATIO : 1.0);
                double live_y = base_mult * accel_mult_y * (XY_ENABLED ? Y_RATIO : 1.0);

                // 4. Transform mouse stroke
                double dx = ms.x * live_x + carryX;
                double dy = ms.y * live_y + carryY;
                carryX = dx - floor(dx);
                carryY = dy - floor(dy);
                ms.x   = (int)floor(dx);
                ms.y   = (int)floor(dy);

                // 5. Periodic live output for UI
                if (DSec(now - last_live).count() > 0.033) { // ~30 Hz
                    last_live = now;
                    // Status bitmask: 1=Paused, 2=RandomizerEnabled, 4=XYEnabled, 8=AccelEnabled
                    int status_bits = 0;
                    if (paused)             status_bits |= 1;
                    if (RANDOMIZER_ENABLED) status_bits |= 2;
                    if (XY_ENABLED)         status_bits |= 4;
                    if (ACCEL_ENABLED)      status_bits |= 8;
                    printf("LIVE:%.4f:%.4f:%d:%.1f:%.1f\n", live_x, live_y, status_bits, speed_x, speed_y);
                    fflush(stdout);
                }
            }

            interception_send(context, device, &stroke, 1);
        }

        if (interception_is_keyboard(device))
        {
            InterceptionKeyStroke& ks = *(InterceptionKeyStroke*)&stroke;
            interception_send(context, device, &stroke, 1);

            if (PAUSE_KEY != 0 && ks.code == (DWORD)PAUSE_KEY && (GetTickCount64() - lastpress > 250)) {
                lastpress = GetTickCount64();
                g_paused.store(!g_paused.load());
            }

            coord.X = 36; coord.Y = 19;
            SetConsoleCursorPosition(hConsole, coord);
            if (g_paused.load()) {
                SetConsoleTextAttribute(hConsole, 0x3f);
                printf(" PAUSED ");
            } else {
                printf("        ");
            }
            SetConsoleTextAttribute(hConsole, 0x08);
        }
    }

    SetConsoleTextAttribute(hConsole, 0x02);
    printf("\n\n\n\n\nDone. Restart the program to generate a new curve.\n\n");
    SetConsoleTextAttribute(hConsole, 0x08);

    interception_destroy_context(context);
    return 0;
}
