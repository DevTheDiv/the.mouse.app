import React from 'react';
import {
  Box, Typography, Paper, Switch, Slider, Stack, CircularProgress
} from '@mui/material';
import { AlignHorizontalLeft } from '@mui/icons-material';
import { useSettings } from '../context/SettingsContext';
import ModulePresetManager from '../components/ModulePresetManager';

export default function Snap() {
  const { settings: s, updateSetting: set, loading } = useSettings();

  const capturePreset = () => ({
    Snap_Enabled: !!s.Snap_Enabled,
    Snap_Threshold: Number(s.Snap_Threshold),
  });

  const applyPreset = (payload) => {
    if (!payload) return;
    if (payload.Snap_Enabled !== undefined) set('Snap_Enabled', !!payload.Snap_Enabled);
    if (payload.Snap_Threshold !== undefined) set('Snap_Threshold', Number(payload.Snap_Threshold));
  };

  if (loading || !s) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>
  );

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <Paper sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>Angle Snapping</Typography>
          <Typography variant="caption" color="text.secondary">
            {s.Snap_Enabled ? 'Enabled — axis snapping active' : 'Disabled — raw movement angles'}
          </Typography>
        </Box>
        <Switch 
          checked={s.Snap_Enabled === '1' || s.Snap_Enabled === true} 
          onChange={e => set('Snap_Enabled', e.target.checked)} 
          color="primary" 
        />
      </Paper>

      <Paper sx={{ p: 4, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: s.Snap_Enabled ? 1 : 0.5, transition: 'opacity 0.2s' }}>
        <Box sx={{ textAlign: 'center', mb: 6 }}>
          <AlignHorizontalLeft sx={{ fontSize: 64, color: 'primary.main', mb: 2, opacity: 0.8 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Snap Intensity</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 450, mx: 'auto' }}>
            Snaps your mouse movement to the nearest 90-degree axis (horizontal or vertical) if within the threshold.
          </Typography>
        </Box>

        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              Threshold (Degrees)
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {parseFloat(s.Snap_Threshold || 5).toFixed(1)}°
            </Typography>
          </Stack>
          <Slider
            value={parseFloat(s.Snap_Threshold || 5)}
            min={1}
            max={45}
            step={0.5}
            onChange={(_, v) => set('Snap_Threshold', v)}
            disabled={!s.Snap_Enabled}
            valueLabelDisplay="auto"
          />
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.disabled">Precise</Typography>
            <Typography variant="caption" color="text.disabled">Aggressive</Typography>
          </Stack>
        </Box>

        <Box sx={{ mt: 8, p: 3, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', maxWidth: 500 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700, color: 'text.secondary' }}>How it works</Typography>
          <Typography variant="caption" color="text.secondary" component="p">
            Angle snapping helps in drawing perfectly straight lines by ignoring small vertical/horizontal deviations. 
            A higher threshold makes it easier to stay on axis but may feel "sticky" when trying to make diagonal movements.
          </Typography>
        </Box>
      </Paper>

      <ModulePresetManager
        moduleKey="snap"
        title="Custom Presets"
        captureData={capturePreset}
        onApplyPreset={applyPreset}
      />
    </Box>
  );
}
