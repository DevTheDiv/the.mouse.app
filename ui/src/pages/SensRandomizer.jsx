import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Divider, Slider, Switch, 
  TextField, Alert, Snackbar, CircularProgress, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { useSettings } from '../context/SettingsContext';

function SliderRow({ label, hint, value, onChange, min, max, step, marks }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
          {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
        </Box>
        <Typography variant="body2" color="primary.main" sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
          {value}
        </Typography>
      </Box>
      <Slider value={value} onChange={(_, v) => onChange(v)} min={min} max={max} step={step} marks={marks} color="primary" />
    </Box>
  );
}

export default function SensRandomizer() {
  const { settings: s, updateSetting: set, loading: settingsLoading } = useSettings();
  const [snack, setSnack] = useState(null);

  useEffect(() => {
    const offErr = window.api.onAppError((msg) => setSnack({ type: 'error', msg }));
    return () => { offErr?.(); };
  }, []);

  if (!s || settingsLoading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>
  );

  return (
    <Box sx={{ p: 3 }}>
      {/* Enable toggle */}
      <Paper sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>Sensitivity Randomizer</Typography>
          <Typography variant="caption" color="text.secondary">
            {s.Randomizer_Enabled ? 'Enabled — will apply on next start' : 'Disabled — mouse pass-through only'}
          </Typography>
        </Box>
        <Switch
          checked={s.Randomizer_Enabled}
          onChange={(e) => set('Randomizer_Enabled', e.target.checked)}
          color="primary"
        />
      </Paper>

      {/* Curve settings */}
      <Paper sx={{ p: 3, mb: 3, opacity: s.Randomizer_Enabled ? 1 : 0.45, transition: 'opacity 0.2s' }}>
        <Typography variant="h6" sx={{ mb: 2.5 }}>Sensitivity Curve</Typography>

        <Box sx={{ mb: 2.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>Curve Mode</Typography>
          <ToggleButtonGroup
            exclusive
            value={s.Smooth ? 'smooth' : 'step'}
            onChange={(_, v) => { if (v !== null) set('Smooth', v === 'smooth'); }}
            size="small"
            color="primary"
          >
            <ToggleButton value="smooth">Smooth</ToggleButton>
            <ToggleButton value="step">Step</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
            {s.Smooth
              ? 'Continuous Gaussian curve — sensitivity flows gradually'
              : 'Discrete jumps held for a fixed duration before changing'}
          </Typography>
        </Box>

        <Divider sx={{ my: 2 }} />

        <SliderRow
          label="Baseline Sensitivity"
          hint="Center of the randomization range"
          value={s.Baseline_Sensitivity}
          onChange={(v) => set('Baseline_Sensitivity', v)}
          min={0.1} max={5} step={0.05}
        />

        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>Sensitivity Range</Typography>
              <Typography variant="caption" color="text.secondary">Min and max multiplier bounds</Typography>
            </Box>
            <Typography variant="body2" color="primary.main" sx={{ fontWeight: 700 }}>
              {s.Min_Sensitivity} – {s.Max_Sensitivity}
            </Typography>
          </Box>
          <Slider
            value={[s.Min_Sensitivity, s.Max_Sensitivity]}
            onChange={(_, v) => { set('Min_Sensitivity', v[0]); set('Max_Sensitivity', v[1]); }}
            min={0.1} max={5} step={0.05} color="primary" disableSwap
          />
        </Box>

        <SliderRow
          label="Spread"
          hint="How much sensitivity wanders from baseline (lognormal variance)"
          value={s.Spread}
          onChange={(v) => set('Spread', v)}
          min={0.01} max={1} step={0.01}
        />

        {s.Smooth ? (
          <SliderRow
            label="Smoothing Level"
            hint="How much Gaussian filtering is applied to the curve"
            value={s.Smoothing}
            onChange={(v) => set('Smoothing', v)}
            min={0} max={5} step={1}
            marks={[
              { value: 0, label: 'Off' },
              { value: 1, label: 'Low' },
              { value: 2, label: 'Med' },
              { value: 3, label: 'High' },
              { value: 4, label: 'V.High' },
              { value: 5, label: 'Max' },
            ]}
          />
        ) : (
          <Box sx={{ mb: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>Timestep (seconds per step)</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              How long each discrete sensitivity value is held
            </Typography>
            <TextField type="number" value={s.Timestep}
              onChange={(e) => set('Timestep', Math.max(1, parseInt(e.target.value) || 1))}
              sx={{ width: 120 }} inputProps={{ min: 1, max: 120 }} />
          </Box>
        )}
      </Paper>

      <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity={snack?.type} onClose={() => setSnack(null)}>{snack?.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
