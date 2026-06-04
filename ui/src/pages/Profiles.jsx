import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Chip,
  TextField,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { DeleteOutline, FolderOpen } from '@mui/icons-material';
import { useSettings } from '../context/SettingsContext';

export default function Profiles() {
  const { refresh } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [newName, setNewName] = useState('');
  const [snack, setSnack] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const data = await window.api.getProfiles();
      setProfiles(data?.profiles || []);
      setActiveProfileId(data?.activeProfileId || null);
    } catch (e) {
      setSnack({ type: 'error', msg: e.message || 'Failed to load profiles.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    const offProfileChanged = window.api.onProfileChanged?.(() => {
      loadProfiles();
      refresh();
    });
    return () => offProfileChanged?.();
  }, [refresh]);

  const handleSwitch = async (profileId) => {
    if (!profileId || profileId === activeProfileId) return;
    setSaving(true);
    try {
      const res = await window.api.setActiveProfile(profileId);
      if (!res?.success) throw new Error(res?.error || 'Could not switch profile.');

      await refresh();
      await window.api.restartAppIfRunning();
      setActiveProfileId(profileId);
      setSnack({ type: 'success', msg: 'Active profile updated.' });
    } catch (e) {
      setSnack({ type: 'error', msg: e.message || 'Could not switch profile.' });
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      const res = await window.api.createProfile({ name: trimmed });
      if (!res?.success) throw new Error(res?.error || 'Could not create profile.');

      setNewName('');
      await loadProfiles();
      await refresh();
      await window.api.restartAppIfRunning();
      setSnack({ type: 'success', msg: `Profile "${trimmed}" created.` });
    } catch (e) {
      setSnack({ type: 'error', msg: e.message || 'Could not create profile.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget?.id) return;

    setSaving(true);
    try {
      const res = await window.api.deleteProfile(deleteTarget.id);
      if (!res?.success) throw new Error(res?.error || 'Could not delete profile.');

      setDeleteTarget(null);
      await loadProfiles();
      await refresh();
      if (res.deletedActive) {
        await window.api.restartAppIfRunning();
      }
      setActiveProfileId(res.activeProfileId || null);
      setSnack({ type: 'success', msg: `Profile "${res.deletedProfileName || 'Unknown'}" deleted.` });
    } catch (e) {
      setSnack({ type: 'error', msg: e.message || 'Could not delete profile.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
          <FolderOpen fontSize="small" color="primary" />
          <Typography variant="h6">Profiles</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 3 }}>
          Switch full configuration sets. The active profile is synced to runtime settings automatically.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 3 }}>
          <TextField
            size="small"
            label="New profile name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            sx={{ minWidth: 240 }}
          />
          <Button variant="contained" onClick={handleCreate} disabled={saving || !newName.trim()}>
            Create Profile
          </Button>
        </Box>

        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {profiles.map((p) => {
            const isActive = p.id === activeProfileId;
            return (
              <Paper
                key={p.id}
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderColor: isActive ? 'primary.main' : 'divider',
                  bgcolor: isActive ? 'rgba(0,229,255,0.06)' : 'transparent',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                      {p.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Updated {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : 'Unknown'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isActive && <Chip size="small" color="primary" label="Active" />}
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteOutline />}
                      onClick={() => setDeleteTarget({ id: p.id, name: p.name, isActive })}
                      disabled={saving || profiles.length <= 1}
                    >
                      Delete
                    </Button>
                    <Button
                      size="small"
                      variant={isActive ? 'outlined' : 'contained'}
                      onClick={() => handleSwitch(p.id)}
                      disabled={saving || isActive}
                    >
                      {isActive ? 'In Use' : 'Use'}
                    </Button>
                  </Box>
                </Box>
              </Paper>
            );
          })}
        </Box>
      </Paper>

      <Snackbar
        open={!!snack}
        autoHideDuration={4500}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity={snack?.type} onClose={() => setSnack(null)}>
          {snack?.msg}
        </Alert>
      </Snackbar>

      <Dialog
        open={!!deleteTarget}
        onClose={() => !saving && setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Profile</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete "{deleteTarget?.name}"?
            {deleteTarget?.isActive ? ' This will switch to another profile first.' : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={saving}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={saving}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
