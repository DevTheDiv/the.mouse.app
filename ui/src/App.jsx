import React from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Box, IconButton, Typography, Tooltip } from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
  Close as CloseIcon,
  Remove as MinimizeIcon,
  CropSquare as MaximizeIcon,
  Mouse,
  SwapVert,
  ShowChart,
} from '@mui/icons-material';
import Dashboard     from './pages/Dashboard';
import SensRandomizer from './pages/SensRandomizer';
import Sensitivity    from './pages/Sensitivity';
import Settings      from './pages/Settings';
import AccelCurve    from './pages/AccelCurve';
import { SettingsProvider } from './context/SettingsContext';
import FloatingActionBar from './components/FloatingActionBar';

function TitleBar() {
  return (
    <Box
      style={{ WebkitAppRegion: 'drag' }}
      sx={{
        height: 38, display: 'flex', alignItems: 'center', px: 2,
        bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider',
        flexShrink: 0, zIndex: 10,
      }}
    >
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mr: 1.5, opacity: 0.8 }} />
      <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 2, fontSize: '0.65rem', color: 'text.secondary', textTransform: 'uppercase' }}>
        the.mouse.app
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Box style={{ WebkitAppRegion: 'no-drag' }} sx={{ display: 'flex', gap: 0.5 }}>
        <Tooltip title="Minimize">
          <IconButton size="small" onClick={() => window.api.minimize()} sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' }, width: 28, height: 28 }}>
            <MinimizeIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Maximize">
          <IconButton size="small" onClick={() => window.api.maximize()} sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' }, width: 28, height: 28 }}>
            <MaximizeIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close to tray">
          <IconButton size="small" onClick={() => window.api.close()} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main', bgcolor: 'rgba(255,82,82,0.1)' }, width: 28, height: 28 }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

const NAV = [
  { path: '/',            label: 'Dashboard',  Icon: DashboardIcon },
  { path: '/sensitivity', label: 'Sensitivity', Icon: SwapVert      },
  { path: '/randomizer',  label: 'Randomizer',  Icon: Mouse         },
  { path: '/accel',       label: 'Accel',      Icon: ShowChart     },
  { path: '/settings',    label: 'Settings',   Icon: SettingsIcon  },
];

function Sidebar() {
  return (
    <Box sx={{
      width: 70, bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      py: 2, gap: 0.5, flexShrink: 0,
    }}>
      {NAV.map(({ path, label, Icon }) => (
        <NavLink key={path} to={path} end={path === '/'} style={{ textDecoration: 'none', width: '100%' }}>
          {({ isActive }) => (
            <Box sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              py: 1.5, gap: 0.5,
              color: isActive ? 'primary.main' : 'text.secondary',
              borderLeft: '2px solid',
              borderColor: isActive ? 'primary.main' : 'transparent',
              bgcolor: isActive ? 'rgba(0,229,255,0.07)' : 'transparent',
              transition: 'all 0.15s ease', cursor: 'pointer',
              '&:hover': { color: isActive ? 'primary.main' : 'text.primary', bgcolor: 'rgba(255,255,255,0.04)' },
            }}>
              <Icon sx={{ fontSize: 20 }} />
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: 0.5 }}>{label}</Typography>
            </Box>
          )}
        </NavLink>
      ))}
    </Box>
  );
}

export default function App() {
  return (
    <HashRouter>
      <SettingsProvider>
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}>
          <TitleBar />
          <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <Sidebar />
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
              <Routes>
                <Route path="/"            element={<Dashboard />}      />
                <Route path="/sensitivity" element={<Sensitivity />}    />
                <Route path="/randomizer"  element={<SensRandomizer />} />
                <Route path="/accel"       element={<AccelCurve />}     />
                <Route path="/settings"    element={<Settings />}       />
              </Routes>
            </Box>
          </Box>
          <FloatingActionBar />
        </Box>
      </SettingsProvider>
    </HashRouter>
  );
}
