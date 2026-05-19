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

#pragma warning(disable : 4996)

using namespace std;
using namespace arma;

// ---- Settings (globals) ----
int    RUNTIME     = 30;
int    SMOOTH_AMT  = 2;
double MAX_SENS    = 2.0,  MIN_SENS       = 0.5;
double SENS_MEAN   = 1.0,  SENS_SPREAD    = 0.6;
double TIMESTEP_MEAN = 0.2, TIMESTEP_STDDEV = 0.1;
double GAUSSIAN_STDDEV = 1000.0, GAUSSIAN_WINDOW_SIZE = 5000.0;
bool   DEBUG = true, VISUALIZE = false, TYPE = true;
bool   INFINITE_MODE = false;

COORD  coord;
HANDLE hConsole = GetStdHandle(STD_OUTPUT_HANDLE);

// ---- Chunk streaming (smooth mode) ----
// 5-minute chunks; overlap absorbs smoothing-edge artifacts
const double CHUNK_SEC = 300.0;
const size_t MAX_BUF   = 3;

struct SensChunk {
    vector<double> t;  // timestamps relative to chunk start (seconds)
    vector<double> s;  // sensitivity multipliers
};

mutex              g_mtx;
condition_variable g_cv;
deque<SensChunk>   g_buf;
atomic<bool>       g_gen_done{false};

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
bool readSettings()
{
    printf("Attempting to open settings file...\n");
    double val; char name[100]; bool garbage = false;

    FILE* fp = fopen("settings.ini", "r+");
    if (!fp) {
        SetConsoleTextAttribute(hConsole, 0x04);
        printf("Cannot read settings file. Using defaults.\n");
        SetConsoleTextAttribute(hConsole, 0x08);
    } else {
        SetConsoleTextAttribute(hConsole, 0x02);
        printf("Settings file found! Reading values. ");
        SetConsoleTextAttribute(hConsole, 0x08);

        for (int i = 0; i < 99 && fscanf(fp, "%s = %lf", name, &val) != EOF; i++) {
            if      (!strcmp(name, "Smooth"))               TYPE          = (bool)val;
            else if (!strcmp(name, "Baseline_Sensitivity")) SENS_MEAN     = val;
            else if (!strcmp(name, "Min_Sensitivity"))      MIN_SENS      = val;
            else if (!strcmp(name, "Max_Sensitivity"))      MAX_SENS      = val;
            else if (!strcmp(name, "Spread"))               SENS_SPREAD   = val;
            else if (!strcmp(name, "Smoothing"))            SMOOTH_AMT    = (int)val;
            else if (!strcmp(name, "Timestep"))             TIMESTEP_MEAN = val;
            else if (!strcmp(name, "Runtime"))              RUNTIME       = (int)val;
            else if (!strcmp(name, "Visualize"))            VISUALIZE     = (bool)val;
            else if (!strcmp(name, "Debug"))                DEBUG         = (bool)val;
            else garbage = true;
        }
        fclose(fp);
    }

    // RUNTIME == 0 means run indefinitely
    INFINITE_MODE = (RUNTIME == 0);

    if (SENS_MEAN <= 0)           { SENS_MEAN    = 1;          garbage = true; }
    if (SENS_SPREAD <= 0)         { SENS_SPREAD  = 1e-7;       garbage = true; }
    if (SENS_MEAN < MIN_SENS)     { MIN_SENS     = SENS_MEAN / 2.0; garbage = true; }
    if (SENS_MEAN > MAX_SENS)     { MAX_SENS     = SENS_MEAN * 2.0; garbage = true; }
    if (SMOOTH_AMT < 0)           { SMOOTH_AMT   = 0;          garbage = true; }
    if (TIMESTEP_MEAN <= 0)       { TIMESTEP_MEAN = 0.2;       garbage = true; }
    if (TYPE != 0 && TYPE != 1)   { TYPE         = 1;          garbage = true; }
    if (!INFINITE_MODE && RUNTIME > 500) RUNTIME = 500;

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
void generatorThread(double start_sens, unsigned seed, double total_sec)
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

        if (!INFINITE_MODE && chunk_lo >= total_sec) break;

        double chunk_hi = chunk_lo + CHUNK_SEC;
        if (!INFINITE_MODE) chunk_hi = min(chunk_hi, total_sec);

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

// ---- Visualize (finite step mode only) ----
void visualize(vector<double>& t, vector<double>& s)
{
    ofstream f("sens_list.txt");
    f << SENS_MEAN << "," << MIN_SENS << "," << MAX_SENS << ","
      << TYPE << "," << SENS_SPREAD << "," << SMOOTH_AMT << ","
      << RUNTIME << "," << VISUALIZE << "," << DEBUG << "\n";
    for (size_t i = 0; i < t.size(); i++)
        f << t[i] << "," << s[i] << "\n";
}

// ---- Main ----
int main()
{
    InterceptionContext context;
    InterceptionDevice  device;
    InterceptionStroke  stroke;

    DWORD prev_mode;
    GetConsoleMode(hConsole, &prev_mode);
    SetConsoleMode(hConsole, prev_mode & ~ENABLE_QUICK_EDIT_MODE);

    raise_process_priority();
    context = interception_create_context();

    // --- Setup and read settings BEFORE touching the interception filter ---
    setUp();
    bool garbage = readSettings();

    // Print settings
    {
        const char* type_str = TYPE ? "1 (Smoothed)" : "0 (Step)";
        printf("\nYour settings are:\n");
        SetConsoleTextAttribute(hConsole, 0x02);
        if (INFINITE_MODE)
            printf("Type: %s\nBase Sensitivity: %.2f\nMin: %.2f\nMax: %.2f\n"
                   "Spread: %.2f\nSmoothing: %d\nTimestep: %.1f s\n"
                   "Runtime: Indefinite\nVisualize: %d\nDebug: %d\n\n",
                   type_str, SENS_MEAN, MIN_SENS, MAX_SENS,
                   SENS_SPREAD, SMOOTH_AMT, TIMESTEP_MEAN, VISUALIZE, DEBUG);
        else
            printf("Type: %s\nBase Sensitivity: %.2f\nMin: %.2f\nMax: %.2f\n"
                   "Spread: %.2f\nSmoothing: %d\nTimestep: %.1f s\n"
                   "Runtime: %d minutes\nVisualize: %d\nDebug: %d\n\n",
                   type_str, SENS_MEAN, MIN_SENS, MAX_SENS,
                   SENS_SPREAD, SMOOTH_AMT, TIMESTEP_MEAN, RUNTIME, VISUALIZE, DEBUG);
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
    coord.X = 20; coord.Y = 19;
    SetConsoleCursorPosition(hConsole, coord);
    SetConsoleTextAttribute(hConsole, 0x5f);
    printf(" [P] to PAUSE ");
    SetConsoleTextAttribute(hConsole, 0x08);
    coord.X = 0; coord.Y = 21;
    SetConsoleCursorPosition(hConsole, coord);

    unsigned seed = (unsigned)chrono::system_clock::now().time_since_epoch().count();
    double   total_sec = RUNTIME * 60.0;

    // ---- Generate curve BEFORE setting up interception filter (fixes mouse freeze) ----
    // For step mode: pre-generate finite; infinite is on-demand in main loop.
    // For smooth mode: background thread generates chunks; we wait for the first one.

    vector<double> step_t, step_s;  // used by step mode
    RawState step_st;               // on-demand state for infinite step mode

    if (TYPE == 0) {
        // Step mode
        step_t.push_back(0.0);
        step_s.push_back(SENS_MEAN);
        step_st.time = 0.0;
        step_st.sens = SENS_MEAN;
        step_st.gen.seed(seed);

        if (!INFINITE_MODE) {
            printf("\nGenerating step curve...");
            rawGen(step_st, total_sec, step_t, step_s);
            printf(" Done.\n");
            if (VISUALIZE) visualize(step_t, step_s);
        } else {
            // Pre-generate a small buffer for the main loop
            rawGen(step_st, TIMESTEP_MEAN * 20, step_t, step_s);
        }
    } else {
        // Smooth mode: launch background thread, wait for first chunk
        printf("\nGenerating sensitivity curve...");
        thread bg(generatorThread, SENS_MEAN, seed, total_sec);
        bg.detach();

        unique_lock<mutex> lk(g_mtx);
        g_cv.wait(lk, [] { return !g_buf.empty() || g_gen_done.load(); });
        printf(" Done.\n");
    }

    // ---- NOW install interception filters (mouse no longer freezes) ----
    interception_set_filter(context, interception_is_mouse,
                            INTERCEPTION_FILTER_MOUSE_MOVE);
    interception_set_filter(context, interception_is_keyboard,
                            INTERCEPTION_FILTER_KEY_DOWN | INTERCEPTION_FILTER_KEY_UP);

    typedef chrono::high_resolution_clock Clock;
    typedef chrono::duration<double>      DSec;

    auto   prog_start = Clock::now();
    double carryX = 0, carryY = 0;
    double sens_mult = SENS_MEAN;
    bool      paused    = false;
    ULONGLONG lastpress = 0;
    bool   running   = true;

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

    if (DEBUG == 0) printf("\nRunning...\n");

    while (interception_receive(context, device = interception_wait(context), &stroke, 1) > 0)
    {
        if (interception_is_mouse(device))
        {
            InterceptionMouseStroke& ms = *(InterceptionMouseStroke*)&stroke;

            if (!(ms.flags & INTERCEPTION_MOUSE_MOVE_ABSOLUTE))
            {
                double t_abs = DSec(Clock::now() - prog_start).count();

                if (!paused)
                {
                    if (TYPE == 0)
                    {
                        // ---- Step mode ----
                        // Extend buffer on-demand for infinite mode
                        if (INFINITE_MODE) {
                            while (step_t.back() <= t_abs + TIMESTEP_MEAN * 10)
                                rawGen(step_st, step_st.time + TIMESTEP_MEAN * 10,
                                       step_t, step_s);
                        }

                        // Advance index
                        while (step_i < step_t.size() && step_t[step_i] <= t_abs)
                            step_i++;

                        if (step_i > 0 && step_i <= step_t.size())
                            sens_mult = step_s[step_i - 1];

                        if (!INFINITE_MODE && t_abs >= total_sec)
                            running = false;
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
                            // t.back() < CHUNK_SEC on the final partial chunk, so check both.
                            bool exhausted = cur_chunk.t.empty()
                                          || t_in > cur_chunk.t.back()
                                          || t_in >= CHUNK_SEC;
                            if (exhausted) {
                                // Non-blocking check: don't stall the mouse loop waiting for the
                                // generator. If the next chunk isn't ready yet, keep the last
                                // sens_mult and retry on the next mouse event.
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
                                    if (g_gen_done && !INFINITE_MODE) {
                                        have_chunk = false;
                                        running = false;
                                    }
                                    // else: generator still running, keep current sens_mult
                                }
                            }
                        } else {
                            // Try to get a chunk if one arrived
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
                                if (g_gen_done && !INFINITE_MODE) running = false;
                            }
                        }
                    }
                }

                if (DEBUG)
                {
                    coord.X = 0; coord.Y = 20;
                    SetConsoleCursorPosition(hConsole, coord);
                    SetConsoleTextAttribute(hConsole, 0x08);
                    printf("\nCurrent Sensitivity Multiplier: ");
                    SetConsoleTextAttribute(hConsole, 0xe0);
                    printf("%.5f\n", sens_mult);
                    SetConsoleTextAttribute(hConsole, 0x08);

                    if (INFINITE_MODE) {
                        printf("Elapsed:             ");
                        SetConsoleTextAttribute(hConsole, 0xe0);
                        int e = (int)DSec(Clock::now() - prog_start).count();
                        printf("%02d:%02d:%02d\n\n", e/3600, (e%3600)/60, e%60);
                    } else {
                        double pct = min(DSec(Clock::now() - prog_start).count()
                                        / total_sec * 100.0, 100.0);
                        printf("Program Termination: ");
                        SetConsoleTextAttribute(hConsole, 0xe0);
                        printf("%.3f%%\n\n", pct);
                    }
                    SetConsoleTextAttribute(hConsole, 0x08);
                }

                double dx = ms.x * sens_mult + carryX;
                double dy = ms.y * sens_mult + carryY;
                carryX = dx - floor(dx);
                carryY = dy - floor(dy);
                ms.x   = (int)floor(dx);
                ms.y   = (int)floor(dy);

                if (!running) {
                    interception_send(context, device, &stroke, 1);
                    break;
                }
            }

            interception_send(context, device, &stroke, 1);
        }

        if (interception_is_keyboard(device))
        {
            InterceptionKeyStroke& ks = *(InterceptionKeyStroke*)&stroke;
            interception_send(context, device, &stroke, 1);

            if (ks.code == 0x19 && (GetTickCount64() - lastpress > 250)) {
                lastpress = GetTickCount64();
                paused    = !paused;
            }

            coord.X = 36; coord.Y = 19;
            SetConsoleCursorPosition(hConsole, coord);
            if (paused) {
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
