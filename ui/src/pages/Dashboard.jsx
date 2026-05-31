import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Chip, Paper, Alert, Snackbar, CircularProgress,
} from '@mui/material';
import { PlayArrow, Stop } from '@mui/icons-material';

export default function Dashboard() {
  const [status,       setStatus]       = useState('stopped');
  const [driverStatus, setDriverStatus] = useState('not_installed');
  const [tools,        setTools]        = useState({ randomizer: true, xy: true, accel: false });
  const [error,        setError]        = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [liveSens,     setLiveSens]     = useState({ x: 1.0, y: 1.0, paused: false, randomizerEnabled: false, xyEnabled: false, accelEnabled: false });

  const isRunning = status === 'running';

  const load = useCallback(async () => {
    try {
      const [st, raw, accel] = await Promise.all([
        window.api.getStatus(), window.api.getSettings(), window.api.getAccelCurve(),
      ]);
      setStatus(st.processStatus);
      setDriverStatus(st.driverStatus);
      setTools({
        randomizer: raw.Randomizer_Enabled === '1' || (raw.Randomizer_Enabled === undefined),
        xy:         raw.XY_Enabled === '1',
        accel:      accel?.enabled ?? false,
      });
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    load();
    const offStatus = window.api.onProcessStatus((d) => setStatus(d.status));
    const offError  = window.api.onAppError((msg) => setError(msg));
    const offLive   = window.api.onLiveSens((d) => {
      setLiveSens(d);
      setTools({ randomizer: d.randomizerEnabled, xy: d.xyEnabled, accel: d.accelEnabled });
    });
    return () => { offStatus?.(); offError?.(); offLive?.(); };
  }, [load]);

  const handleStartStop = async () => {
    setLoading(true);
    try {
      if (isRunning) await window.api.stopApp();
      else           await window.api.startApp();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '90%' }}>
      <Box sx={{ textAlign: 'center', maxWidth: 450, width: '100%' }}>
        <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: 2, mb: 0.5, color: 'text.primary' }}>
          the.mouse.app
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 6, letterSpacing: 1 }}>
          Mouse control tools for aim trainers
        </Typography>

        {/* Status indicator */}
        <Box sx={{
          width: 90, height: 90, borderRadius: '50%', mx: 'auto', mb: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: isRunning ? 'rgba(0,230,118,0.05)' : 'rgba(255,255,255,0.02)',
          border: '1px solid',
          borderColor: isRunning ? 'success.main' : 'rgba(255,255,255,0.08)',
          boxShadow: isRunning ? '0 0 40px rgba(0,230,118,0.15)' : 'none',
          transition: 'all 0.4s ease',
        }}>
          <Box sx={{
            width: 18, height: 18, borderRadius: '50%',
            bgcolor: isRunning ? 'success.main' : 'rgba(255,255,255,0.1)',
            boxShadow: isRunning ? '0 0 12px rgba(0,230,118,0.8)' : 'none',
            transition: 'all 0.4s ease',
          }} />
        </Box>

        <Typography variant="h5" color={isRunning ? (liveSens.paused ? 'warning.main' : 'success.main') : 'text.secondary'}
          sx={{ mb: 5, fontWeight: 600, transition: 'color 0.3s', textTransform: 'uppercase', letterSpacing: 2 }}>
          {isRunning ? 'Active' : 'Inactive'}
        </Typography>

        {isRunning && (
          <Box sx={{ mb: 6, width: '100%' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.7 }}>
              Live Multipliers
            </Typography>
            <Box sx={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
              <Box sx={{ flex: 1, py: 2.5, px: 2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)', bgcolor: 'rgba(255,255,255,0.01)' }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>X Axis</Typography>
                <Typography variant="h4" sx={{ fontWeight: 800, fontFamily: 'monospace', color: 'primary.main', letterSpacing: -1 }}>
                  {liveSens.x.toFixed(4)}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, py: 2.5, px: 2, borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)', bgcolor: 'rgba(255,255,255,0.01)' }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Y Axis</Typography>
                <Typography variant="h4" sx={{ fontWeight: 800, fontFamily: 'monospace', color: 'primary.main', letterSpacing: -1 }}>
                  {liveSens.y.toFixed(4)}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}

        <Box sx={{ mb: 6, display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
          <Button
            variant={isRunning ? 'outlined' : 'contained'}
            color={isRunning ? 'error' : 'primary'}
            size="large"
            onClick={handleStartStop}
            disabled={loading || (!isRunning && driverStatus !== 'installed')}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : isRunning ? <Stop /> : <PlayArrow />}
            sx={{ 
              px: 8, py: 2, fontSize: '1.2rem', minWidth: 240, borderRadius: 3, mb: 2,
              fontWeight: 700,
              boxShadow: !isRunning && driverStatus === 'installed' ? '0 8px 24px rgba(0,229,255,0.2)' : 'none',
              transition: 'all 0.3s ease',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: !isRunning && driverStatus === 'installed' ? '0 12px 32px rgba(0,229,255,0.3)' : 'none',
              }
            }}
          >
            {loading ? '...' : isRunning ? 'Stop' : 'Start'}
          </Button>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ 
              width: 10, height: 10, borderRadius: '50%', 
              bgcolor: driverStatus === 'installed' ? 'success.main' : 'error.main',
              boxShadow: driverStatus === 'installed' ? '0 0 10px rgba(0,230,118,0.5)' : 'none'
            }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
              Driver {driverStatus === 'installed' ? 'Ready' : 'Missing'}
            </Typography>
          </Box>
          
          {driverStatus !== 'installed' && !isRunning && (
            <Typography variant="caption" color="error.main" sx={{ mt: 1.5, display: 'block', maxWidth: 220, fontWeight: 500 }}>
              Installation required in Settings
            </Typography>
          )}
        </Box>

        {/* Active tools */}
        <Box sx={{ 
          display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap', pt: 4, 
          borderTop: '1px solid', borderColor: 'rgba(255,255,255,0.08)',
          width: '100%'
        }}>
          <Typography variant="caption" sx={{ width: '100%', mb: 1.5, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700, fontSize: '0.7rem' }}>
            Active Modules
          </Typography>
          <Chip
            size="small"
            variant={tools.randomizer ? 'filled' : 'outlined'}
            color={tools.randomizer ? 'primary' : 'default'}
            label="Randomizer"
            sx={{ 
              fontSize: '0.7rem', height: 24, px: 1,
              opacity: tools.randomizer ? 1 : 0.4,
              fontWeight: 600
            }}
          />
          <Chip
            size="small"
            variant={tools.xy ? 'filled' : 'outlined'}
            color={tools.xy ? 'primary' : 'default'}
            label="X/Y Decoupling"
            sx={{ fontSize: '0.7rem', height: 24, px: 1, opacity: tools.xy ? 1 : 0.4, fontWeight: 600 }}
          />
          <Chip
            size="small"
            variant={tools.accel ? 'filled' : 'outlined'}
            color={tools.accel ? 'primary' : 'default'}
            label="Accel Curve"
            sx={{ fontSize: '0.7rem', height: 24, px: 1, opacity: tools.accel ? 1 : 0.4, fontWeight: 600 }}
          />
        </Box>
      </Box>

      <Snackbar open={!!error} autoHideDuration={7000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}
