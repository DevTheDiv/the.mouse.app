import { createTheme } from '@mui/material';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#00e5ff', dark: '#00b2cc', light: '#60efff' },
    secondary:  { main: '#7c4dff' },
    success:    { main: '#00e676' },
    error:      { main: '#ff5252' },
    warning:    { main: '#ffd740' },
    background: { default: '#0a0a0f', paper: '#12121a' },
    text:       { primary: '#e8e8f0', secondary: '#72728a' },
    divider:    'rgba(255,255,255,0.06)',
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", "Roboto", sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', border: '1px solid rgba(255,255,255,0.06)' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, borderRadius: 8 },
        containedPrimary: {
          background: 'linear-gradient(135deg, #00e5ff 0%, #00b2cc 100%)',
          color: '#000',
          '&:hover': { background: 'linear-gradient(135deg, #60efff 0%, #00e5ff 100%)' },
          '&:disabled': { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' },
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: { '&.Mui-checked': { color: '#00e5ff' } },
        track: { '.Mui-checked.Mui-checked + &': { backgroundColor: '#00e5ff' } },
      },
    },
    MuiSlider: {
      styleOverrides: {
        thumb: {
          '&:hover, &.Mui-focusVisible': { boxShadow: '0 0 0 8px rgba(0,229,255,0.16)' },
        },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
            '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.25)' },
            '&.Mui-focused fieldset': { borderColor: '#00e5ff' },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
  },
});

export default theme;
