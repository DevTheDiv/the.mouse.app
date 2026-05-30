import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Switch, FormControlLabel,
  Button, Alert, Snackbar, CircularProgress,
  Chip, IconButton, Tooltip,
} from '@mui/material';
import {
  Download, DeleteOutline, CheckCircle, Error as ErrorIcon,
  Warning, Refresh,
} from '@mui/icons-material';
import { useSettings } from '../context/SettingsContext';

const DRIVER_STATUS = {
  installed:       { color: 'success', label: 'Installed & Active',          Icon: CheckCircle },
  not_installed:   { color: 'error',   label: 'Not Installed',               Icon: ErrorIcon   },
  reboot_required: { color: 'warning', label: 'Driver Installed (Not Active)', Icon: Warning     },
};

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <FormControlLabel
      control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} color="primary" />}
      label={
        <Box sx={{ ml: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
          {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
        </Box>
      }
      sx={{ mb: 1, alignItems: 'flex-start', display: 'flex' }}
    />
  );
}

export default function Settings() {
  const { settings, updateSetting, loading: settingsLoading } = useSettings();
  const [driverStatus, setDriverStatus] = useState('not_installed');
  const [loading,      setLoading]      = useState(null);
  const [driverResult, setDriverResult] = useState(null);
  const [autoStart,    setAutoStart]    = useState(false);
  const [snack,        setSnack]        = useState(null);
  const [listening,    setListening]    = useState(null); // 'startStop' | 'pause' | null

  const refreshDriver = async () => setDriverStatus(await window.api.getDriverStatus());

  useEffect(() => {
    refreshDriver();
    window.api.getStatus().then((st) => setAutoStart(!!st.autoStart));
  }, []);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { setListening(null); return; }
      
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
      if (e.altKey)   parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      
      let key = e.key;
      if (key === ' ') key = 'Space';
      if (key.length === 1) key = key.toUpperCase();
      // Handle some special keys to match Electron's naming
      if (key === 'ArrowUp') key = 'Up';
      if (key === 'ArrowDown') key = 'Down';
      if (key === 'ArrowLeft') key = 'Left';
      if (key === 'ArrowRight') key = 'Right';

      parts.push(key);
      const combo = parts.join('+');
      
      updateSetting(listening === 'startStop' ? 'Hotkey_StartStop' : 'Hotkey_Pause', combo);
      setListening(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening, updateSetting]);

  const clearHotkey = (type) => {
    updateSetting(type === 'startStop' ? 'Hotkey_StartStop' : 'Hotkey_Pause', '');
  };

  const act = async (action) => {
    setLoading(action); setDriverResult(null);
    try {
      const r = action === 'install'
        ? await window.api.installDriver()
        : await window.api.uninstallDriver();
      if (r.success) {
        setDriverStatus(r.status);
        setDriverResult({ type: 'success', msg: action === 'install'
          ? 'Driver installed. A reboot may be required before it activates.'
          : 'Driver uninstall queued. Reboot to fully remove the driver files.' });
      } else {
        setDriverResult({ type: 'error', msg: r.error || 'Operation failed.' });
      }
    } catch (e) { setDriverResult({ type: 'error', msg: e.message }); }
    finally { setLoading(null); }
  };

  const handleAutoStart = async (checked) => {
    setAutoStart(await window.api.setAutostart(checked));
  };

  if (!settings || settingsLoading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>
  );

  const hotkeys = {
    startStop: settings.Hotkey_StartStop,
    pause:     settings.Hotkey_Pause,
  };

  const cfg = DRIVER_STATUS[driverStatus] || { color: 'default', label: driverStatus, Icon: ErrorIcon };

  return (
    <Box sx={{ p: 3 }}>
      {/* Driver */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">Interception Driver</Typography>
          <Tooltip title="Refresh status">
            <IconButton size="small" onClick={refreshDriver} sx={{ color: 'text.secondary' }}>
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
          <cfg.Icon color={cfg.color} fontSize="small" />
          <Chip size="small" color={cfg.color} variant="outlined" label={cfg.label} />
        </Box>

        <Alert severity="info" sx={{ mb: 2.5, fontSize: '0.8rem' }}>
          Kernel-level mouse capture. Requires Secure Boot <strong>disabled</strong> and a reboot to activate.
        </Alert>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" color="primary"
            startIcon={loading === 'install' ? <CircularProgress size={15} color="inherit" /> : <Download />}
            onClick={() => act('install')} disabled={!!loading || driverStatus === 'installed'}>
            Install Driver
          </Button>
          <Button variant="outlined" color="error"
            startIcon={loading === 'uninstall' ? <CircularProgress size={15} color="inherit" /> : <DeleteOutline />}
            onClick={() => act('uninstall')} disabled={!!loading || driverStatus === 'not_installed'}>
            Uninstall Driver
          </Button>
        </Box>

        {driverResult && <Alert severity={driverResult.type} sx={{ mt: 2 }}>{driverResult.msg}</Alert>}
      </Paper>

      {/* Global Hotkeys */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 0.5 }}>Global Hotkeys</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 3 }}>
          System-wide shortcuts to control the application while it's in the background.
        </Typography>

        {/* Start / Stop */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Start / Stop Program</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{
              px: 2.5, py: 1, borderRadius: 1, border: '1px solid',
              borderColor: listening === 'startStop' ? 'primary.main' : 'rgba(255,255,255,0.15)',
              bgcolor: listening === 'startStop' ? 'rgba(0,229,255,0.08)' : 'rgba(255,255,255,0.03)',
              minWidth: 120, textAlign: 'center', cursor: 'default',
            }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}
                color={listening === 'startStop' ? 'primary.main' : hotkeys.startStop ? 'text.primary' : 'text.disabled'}>
                {listening === 'startStop' ? 'press keys…' : hotkeys.startStop || 'None'}
              </Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={() => setListening('startStop')} disabled={!!listening}>
              {hotkeys.startStop ? 'Rebind' : 'Bind'}
            </Button>
            {hotkeys.startStop && (
              <Button size="small" variant="outlined" color="error" onClick={() => clearHotkey('startStop')} disabled={!!listening}>
                Clear
              </Button>
            )}
          </Box>
        </Box>

        {/* Pause / Resume */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Pause / Resume Randomizer</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{
              px: 2.5, py: 1, borderRadius: 1, border: '1px solid',
              borderColor: listening === 'pause' ? 'primary.main' : 'rgba(255,255,255,0.15)',
              bgcolor: listening === 'pause' ? 'rgba(0,229,255,0.08)' : 'rgba(255,255,255,0.03)',
              minWidth: 120, textAlign: 'center', cursor: 'default',
            }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700 }}
                color={listening === 'pause' ? 'primary.main' : hotkeys.pause ? 'text.primary' : 'text.disabled'}>
                {listening === 'pause' ? 'press keys…' : hotkeys.pause || 'None'}
              </Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={() => setListening('pause')} disabled={!!listening}>
              {hotkeys.pause ? 'Rebind' : 'Bind'}
            </Button>
            {hotkeys.pause && (
              <Button size="small" variant="outlined" color="error" onClick={() => clearHotkey('pause')} disabled={!!listening}>
                Clear
              </Button>
            )}
          </Box>
        </Box>

        {listening && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Esc to cancel
          </Typography>
        )}
      </Paper>

      {/* Application */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Application</Typography>
        <ToggleRow
          label="Start with Windows"
          hint="Launch automatically when you log in"
          checked={autoStart}
          onChange={handleAutoStart}
        />
      </Paper>

      <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)}>
        <Alert severity={snack?.type} onClose={() => setSnack(null)}>{snack?.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
