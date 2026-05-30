import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const SettingsContext = createContext(null);

export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [originalSettings, setOriginalSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await window.api.getSettings();
      // Normalize values to ensure consistent types for comparison
      const normalized = {
        Randomizer_Enabled:   raw.Randomizer_Enabled  !== '0',
        Smooth:               raw.Smooth              === '1',
        Baseline_Sensitivity: parseFloat(raw.Baseline_Sensitivity) || 1,
        Min_Sensitivity:      parseFloat(raw.Min_Sensitivity)      || 0.5,
        Max_Sensitivity:      parseFloat(raw.Max_Sensitivity)      || 2,
        Spread:               parseFloat(raw.Spread)               || 0.1,
        Smoothing:            parseInt(raw.Smoothing)              || 5,
        Timestep:             parseInt(raw.Timestep)               || 3,
        XY_Enabled:           raw.XY_Enabled          !== '0',
        X_Sensitivity:        parseFloat(raw.X_Sensitivity)        || 1,
        Y_Sensitivity:        parseFloat(raw.Y_Sensitivity)        || 1,
        Hotkey_StartStop:     raw.Hotkey_StartStop                 || '',
        Hotkey_Pause:         raw.Hotkey_Pause                     || '',
      };
      setSettings(normalized);
      setOriginalSettings(JSON.stringify(normalized));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSetting = (key, val) => {
    setSettings(prev => ({ ...prev, [key]: val }));
  };

  const resetSettings = () => {
    if (originalSettings) {
      setSettings(JSON.parse(originalSettings));
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const toSave = {
        ...settings,
        Randomizer_Enabled:   settings.Randomizer_Enabled   ? '1' : '0',
        Smooth:               settings.Smooth               ? '1' : '0',
        Baseline_Sensitivity: String(settings.Baseline_Sensitivity),
        Min_Sensitivity:      String(settings.Min_Sensitivity),
        Max_Sensitivity:      String(settings.Max_Sensitivity),
        Spread:               String(settings.Spread),
        Smoothing:            String(settings.Smoothing),
        Timestep:             String(settings.Timestep),
        XY_Enabled:           settings.XY_Enabled           ? '1' : '0',
        X_Sensitivity:        String(settings.X_Sensitivity),
        Y_Sensitivity:        String(settings.Y_Sensitivity),
        Hotkey_StartStop:     settings.Hotkey_StartStop,
        Hotkey_Pause:         settings.Hotkey_Pause,
      };
      await window.api.saveSettings(toSave);
      await window.api.restartAppIfRunning();
      setOriginalSettings(JSON.stringify(settings));
      return { success: true };
    } catch (e) {
      setError(e.message);
      return { success: false, error: e.message };
    } finally {
      setSaving(false);
    }
  };

  const isDirty = originalSettings !== JSON.stringify(settings);

  const value = {
    settings,
    loading,
    saving,
    error,
    isDirty,
    updateSetting,
    saveSettings,
    resetSettings,
    refresh: fetchSettings,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
