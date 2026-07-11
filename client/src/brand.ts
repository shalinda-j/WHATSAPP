/**
 * Single source of truth for the app's branding — used by Layout + Login so a
 * rebrand is one edit here (plus swapping the images in client/public/, keeping
 * the SAME filenames, which also updates the favicon referenced by index.html).
 *
 * To rebrand: change the strings below and drop your own logo.png / logo-large.png
 * over client/public/360ai.png and 360ai-b.png (and 360ai-i.ico for the favicon).
 */
export const BRAND = {
  name: '360ai',
  tagline: 'All In One AI Solutions',
  product: 'WhatsApp Bot System',
  logo: '/360ai.png', // sidebar + mobile header
  logoLarge: '/360ai-b.png', // login screen
};
