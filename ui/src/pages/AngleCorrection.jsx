import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Switch, TextField, CircularProgress, 
  IconButton, Tooltip, Divider, Stack
} from '@mui/material';
import { RestartAlt, Rotate90DegreesCcw } from '@mui/icons-material';
import { useSettings } from '../context/SettingsContext';

const DIAL_SIZE = 240;
const CENTER = DIAL_SIZE / 2;

export default function AngleCorrection() {
  const { settings: s, updateSetting: set, loading } = useSettings();
  const [isDragging, setIsDragging] = useState(false);
  const dialRef = useRef(null);

  const angle = s?.Angle_Value ?? 0;

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || !dialRef.current) return;
    const rect = dialRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    
    // Calculate angle in degrees. 
    // In screen space (y-down), atan2(dy, dx) gives angle from positive X axis.
    // We want 0 degrees to be "Up" (negative Y).
    let deg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    
    // Normalize to [-180, 180]
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;

    set('Angle_Value', parseFloat(deg.toFixed(1)));
  }, [isDragging, set]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (loading || !s) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>
  );

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <Paper sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>Angle Correction</Typography>
          <Typography variant="caption" color="text.secondary">
            {s.Angle_Enabled ? 'Enabled — sensor rotation active' : 'Disabled — raw sensor orientation'}
          </Typography>
        </Box>
        <Switch 
          checked={s.Angle_Enabled} 
          onChange={e => set('Angle_Enabled', e.target.checked)} 
          color="primary" 
        />
      </Paper>

      <Paper sx={{ p: 4, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: s.Angle_Enabled ? 1 : 0.5, transition: 'opacity 0.2s' }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h6">Grip Compensation</Typography>
          <Typography variant="caption" color="text.secondary">
            Rotate the dial to match your mouse grip tilt.
          </Typography>
        </Box>

        <Box 
          ref={dialRef}
          onMouseDown={() => s.Angle_Enabled && setIsDragging(true)}
          sx={{ 
            position: 'relative', 
            width: DIAL_SIZE, 
            height: DIAL_SIZE, 
            cursor: s.Angle_Enabled ? (isDragging ? 'grabbing' : 'grab') : 'default',
            userSelect: 'none'
          }}
        >
          {/* Background Track */}
          <svg width={DIAL_SIZE} height={DIAL_SIZE} viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}>
            <circle cx={CENTER} cy={CENTER} r={CENTER - 10} fill="rgba(0,0,0,0.2)" stroke="rgba(255,255,255,0.1)" strokeWidth={2} />
            
            {/* Degree ticks */}
            {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].map(tick => {
              const rad = (tick - 90) * (Math.PI / 180);
              const isMajor = tick % 90 === 0;
              const x1 = CENTER + (CENTER - 25) * Math.cos(rad);
              const y1 = CENTER + (CENTER - 25) * Math.sin(rad);
              const x2 = CENTER + (CENTER - 12) * Math.cos(rad);
              const y2 = CENTER + (CENTER - 12) * Math.sin(rad);
              return (
                <line key={tick} x1={x1} y1={y1} x2={x2} y2={y2} stroke={tick === 0 ? "primary.main" : "rgba(255,255,255,0.3)"} strokeWidth={isMajor ? 3 : 1} />
              );
            })}

            {/* Rotating Indicator */}
            <g transform={`rotate(${angle}, ${CENTER}, ${CENTER})`}>
              {/* The "Mouse" representation */}
              <rect x={CENTER - 25} y={CENTER - 40} width={50} height={80} rx={25} fill="rgba(0,229,255,0.1)" stroke="#00e5ff" strokeWidth={2} />
              <line x1={CENTER} y1={CENTER - 40} x2={CENTER} y2={CENTER - 60} stroke="#00e5ff" strokeWidth={3} strokeLinecap="round" />
              <circle cx={CENTER} cy={CENTER - 15} r={4} fill="#00e5ff" />
            </g>
          </svg>
        </Box>

        <Stack direction="row" spacing={3} alignItems="center" sx={{ mt: 5 }}>
          <TextField
            label="Rotation (degrees)"
            type="number"
            size="small"
            value={angle}
            onChange={e => {
              let v = parseFloat(e.target.value);
              if (!isNaN(v)) set('Angle_Value', Math.max(-180, Math.min(180, v)));
            }}
            inputProps={{ step: 0.1, min: -180, max: 180 }}
            sx={{ width: 140 }}
            disabled={!s.Angle_Enabled}
          />
          <Tooltip title="Reset to 0°">
            <IconButton onClick={() => set('Angle_Value', 0)} disabled={!s.Angle_Enabled || angle === 0}>
              <RestartAlt />
            </IconButton>
          </Tooltip>
        </Stack>

        <Box sx={{ mt: 4, maxWidth: 400, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            If you hold your mouse at an angle, "straight" physical movements become diagonal on screen.
            This setting rotates the input back to match your hand, improving verticality and horizontal consistency.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
