import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Snackbar,
  Alert,
} from '@mui/material';

export default function ModulePresetManager({
  moduleKey,
  title = 'Saved Presets',
  captureData,
  onApplyPreset,
  disabled = false,
}) {
  const [presets, setPresets] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState(null);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = async () => {
    try {
      const data = await window.api.getModulePresets(moduleKey);
      setPresets(Array.isArray(data) ? data : []);
    } catch (e) {
      setSnack({ type: 'error', msg: e.message || 'Failed to load presets.' });
    }
  };

  useEffect(() => {
    load();
  }, [moduleKey]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      const res = await window.api.saveModulePreset({
        module: moduleKey,
        name: trimmed,
        data: captureData(),
      });
      if (!res?.success) throw new Error(res?.error || 'Failed to save preset.');
      setName('');
      await load();
      setSnack({ type: 'success', msg: `Saved preset "${trimmed}".` });
    } catch (e) {
      setSnack({ type: 'error', msg: e.message || 'Failed to save preset.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    setBusy(true);
    try {
      const res = await window.api.deleteModulePreset({ module: moduleKey, id });
      if (!res?.success) throw new Error(res?.error || 'Failed to delete preset.');
      await load();
    } catch (e) {
      setSnack({ type: 'error', msg: e.message || 'Failed to delete preset.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSelectPreset = (preset) => {
    if (!preset) return;
    setSelectedPresetId(preset.id);
    onApplyPreset(preset.payload);
  };

  return (
    <Paper sx={{ mt: 2, pt: 3.5, px: 3, pb: 3, mb: 3, opacity: disabled ? 0.5 : 1, transition: 'opacity 0.2s' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>{title}</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Save your current module configuration and reapply it anytime.
      </Typography>

      <Stack direction="row" spacing={1.2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          disabled={busy || disabled}
        />
        <Button variant="contained" onClick={handleSave} disabled={busy || disabled || !name.trim()}>
          Save
        </Button>
      </Stack>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {presets.map((p) => (
          <Chip
            key={p.id}
            label={p.name}
            clickable
            onClick={() => handleSelectPreset(p)}
            onDelete={() => setDeleteTarget(p)}
            color={selectedPresetId === p.id ? 'primary' : 'default'}
            variant={selectedPresetId === p.id ? 'filled' : 'outlined'}
            disabled={busy || disabled}
            sx={{ fontWeight: 700 }}
          />
        ))}
      </Box>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Preset?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`Delete preset "${deleteTarget?.name || ''}"? This cannot be undone.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</Button>
          <Button
            color="error"
            onClick={async () => {
              const target = deleteTarget;
              setDeleteTarget(null);
              if (!target) return;
              await handleDelete(target.id);
              if (selectedPresetId === target.id) setSelectedPresetId(null);
            }}
            disabled={busy}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snack}
        autoHideDuration={3500}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity={snack?.type} onClose={() => setSnack(null)}>{snack?.msg}</Alert>
      </Snackbar>
    </Paper>
  );
}
