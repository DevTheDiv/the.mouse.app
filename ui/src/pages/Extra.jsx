import React from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
} from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import { useSettings } from '../context/SettingsContext';

export default function Extra() {
  const { settings, loading } = useSettings();

  if (!settings || loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <AutoAwesome fontSize="small" color="primary" />
          <Typography variant="h6">Extra</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 3 }}>
          Experimental and quality-of-life features that do not need dedicated tabs.
        </Typography>

        <Paper variant="outlined" sx={{ p: 2, borderColor: 'divider', bgcolor: 'rgba(255,255,255,0.02)' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            No extra features active
          </Typography>
          <Typography variant="caption" color="text.secondary">
            This category is reserved for optional and experimental modules.
          </Typography>
        </Paper>
      </Paper>
    </Box>
  );
}
