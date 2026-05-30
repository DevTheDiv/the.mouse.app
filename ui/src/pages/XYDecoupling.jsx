import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Paper, Button, Slider, Switch, CircularProgress } from '@mui/material';
import { useSettings } from '../context/SettingsContext';

function SliderRow({ label, hint, value, onChange, min, max, step }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
          {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
        </Box>
        <Typography variant="body2" color="primary.main" sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
          {value.toFixed(2)}
        </Typography>
      </Box>
      <Slider value={value} onChange={(_, v) => onChange(v)} min={min} max={max} step={step} color="primary" />
    </Box>
  );
}

const PRESETS = [
  { label: '1:1 (even)',  x: 1,    y: 1      },
  { label: '1:0.75',      x: 1,    y: 0.75   },
  { label: '1:0.5',       x: 1,    y: 0.5    },
  { label: '16:9 → 4:3',  x: 1,    y: 0.5625 },
];

export default function XYDecoupling() {
  const { settings: s, updateSetting: set, loading: settingsLoading, refresh } = useSettings();

  useEffect(() => { refresh(); }, [refresh]);

  if (!s || settingsLoading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>
  );

  return (
    <Box sx={{ p: 3 }}>
      {/* Enable toggle */}
      <Paper sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>X/Y Decoupling</Typography>
          <Typography variant="caption" color="text.secondary">
            {s.XY_Enabled ? 'Enabled — axis multipliers active on next start' : 'Disabled — both axes treated equally'}
          </Typography>
        </Box>
        <Switch
          checked={s.XY_Enabled}
          onChange={(e) => set('XY_Enabled', e.target.checked)}
          color="primary"
        />
      </Paper>

      <Paper sx={{ p: 3, mb: 3, opacity: s.XY_Enabled ? 1 : 0.45, transition: 'opacity 0.2s' }}>
        <Typography variant="h6" sx={{ mb: 0.5 }}>Axis Multipliers</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 3 }}>
          Set a permanent per-axis sensitivity scale. 1.0 = no change.
        </Typography>

        <SliderRow
          label="X Sensitivity"
          hint="Horizontal axis multiplier"
          value={s.X_Sensitivity}
          onChange={(v) => set('X_Sensitivity', v)}
          min={0.1} max={3} step={0.01}
        />
        <SliderRow
          label="Y Sensitivity"
          hint="Vertical axis multiplier"
          value={s.Y_Sensitivity}
          onChange={(v) => set('Y_Sensitivity', v)}
          min={0.1} max={3} step={0.01}
        />

        <Box sx={{
          mt: 1, p: 2, borderRadius: 2,
          bgcolor: 'rgba(0,229,255,0.05)',
          border: '1px solid rgba(0,229,255,0.15)',
        }}>
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.6rem' }}>
            X : Y ratio
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.5 }}>
            <Typography variant="h5" color="primary.main" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
              {s.X_Sensitivity.toFixed(2)}
            </Typography>
            <Typography variant="body1" color="text.secondary">:</Typography>
            <Typography variant="h5" color="primary.main" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
              {s.Y_Sensitivity.toFixed(2)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              (Y is {(s.Y_Sensitivity / s.X_Sensitivity * 100).toFixed(1)}% of X)
            </Typography>
          </Box>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, mb: 3, opacity: s.XY_Enabled ? 1 : 0.45, transition: 'opacity 0.2s' }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Presets</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Common aspect ratio corrections
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {PRESETS.map(({ label, x, y }) => (
            <Button key={label} size="small" variant="outlined" color="primary"
              onClick={() => { set('X_Sensitivity', x); set('Y_Sensitivity', parseFloat(y.toFixed(4))); }}
              sx={{ fontSize: '0.75rem' }}>
              {label}
            </Button>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
