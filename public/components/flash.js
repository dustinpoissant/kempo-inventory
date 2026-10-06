import Toast from '/kempo-ui/components/Toast.js';

/*
  A message left by the page you just came from ("Added Vallejo Red"), shown once. A page that follows a
  save calls this when it loads:

    import { showFlash } from '/inventory/components/flash.js';
    showFlash();
*/
const FLASH_KEY = 'inventory.flash';

export const showFlash = () => {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if(!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    const { message } = JSON.parse(raw);
    if(message) Toast.success(message);
  } catch { /* nothing to show */ }
};
