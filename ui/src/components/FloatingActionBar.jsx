import React, { useState } from 'react';
import { Box, Button, Paper, CircularProgress, Snackbar, Alert, Fade } from '@mui/material';
import { Save, RestartAlt } from '@mui/icons-material';
import { useSettings } from '../context/SettingsContext';

export default function FloatingActionBar() {
  const { isDirty, saving, saveSettings, resetSettings } = useSettings();
  const [snack, setSnack] = useState(null);

  const handleApply = async () => {
    const result = await saveSettings();
    if (result.success) {
      setSnack({ type: 'success', msg: 'Settings applied successfully!' });
    } else {
      setSnack({ type: 'error', msg: `Failed to apply settings: ${result.error}` });
    }
  };

  return (
    <>
      <Fade in={isDirty || saving}>
        <Paper
          elevation={12}
          sx={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            p: 1.5,
            borderRadius: 3,
            display: 'flex',
            gap: 1.5,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'primary.main',
            boxShadow: isDirty ? '0 0 20px rgba(0,229,255,0.25)' : 'none',
            zIndex: 1000,
            transition: 'all 0.3s ease',
          }}
        >
          <Button
            variant="text"
            color="inherit"
            startIcon={<RestartAlt />}
            onClick={resetSettings}
            disabled={saving}
            size="small"
            sx={{ color: 'text.secondary' }}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <Save />}
            onClick={handleApply}
            disabled={saving}
            size="small"
            sx={{
              px: 3,
              fontWeight: 700,
              boxShadow: isDirty ? '0 0 12px rgba(0,229,255,0.5)' : 'none',
              animation: isDirty ? 'pulse 2s infinite' : 'none',
              '@keyframes pulse': {
                '0%': { boxShadow: '0 0 0 0 rgba(0,229,255,0.4)' },
                '70%': { boxShadow: '0 0 0 10px rgba(0,229,255,0)' },
                '100%': { boxShadow: '0 0 0 0 rgba(0,229,255,0)' },
              },
            }}
          >
            {saving ? 'Applying…' : 'Apply'}
          </Button>
        </Paper>
      </Fade>

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity={snack?.type} onClose={() => setSnack(null)}>
          {snack?.msg}
        </Alert>
      </Snackbar>
    </>
  );
}
