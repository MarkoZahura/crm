/* ==========================================================================
   sync-config.js — налаштування синхронізації через Firebase.

   Ці значення НЕ секретні: за документацією Firebase ключ apiKey лише
   вказує, до якого проєкту звертатися, і його можна тримати в коді
   (https://firebase.google.com/docs/projects/api-keys). Дані захищають
   правила доступу Firestore: читати й змінювати їх може лише той, хто
   увійшов своїм Google-акаунтом (див. README, розділ «Синхронізація»).

   Бібліотека Firebase 12.19.0 (збірки «compat», звичайні скрипти) —
   з jsDelivr з перевіркою цілісності файлів (integrity).
   ========================================================================== */
window.CRM = window.CRM || {};

CRM.SYNC_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyC48x3c3ETkb45DRcw-JRtECITO7AtSh8c',
    authDomain: 'moya-crm.firebaseapp.com',
    projectId: 'moya-crm',
    storageBucket: 'moya-crm.firebasestorage.app',
    messagingSenderId: '861890839592',
    appId: '1:861890839592:web:e081e58dcd75c9178d611d'
  },
  sdkBase: 'https://cdn.jsdelivr.net/npm/firebase@12.19.0/',
  sdkFiles: [
    { name: 'firebase-app-compat.js', integrity: 'sha384-aUtWR1iCiOCHS8pn1nKNXMZm3I/eDrV63IXWXgE+mHHqJfYTWYV+jGk0sCXz57+U' },
    { name: 'firebase-auth-compat.js', integrity: 'sha384-ZRqyA8Xkw0A6FmVya9A0Werzt9yjKKAp2TCzqVJjHK1O3oyb0z9jMxpkWPVoFtUm' },
    { name: 'firebase-firestore-compat.js', integrity: 'sha384-jxdN9nS+cvQavyzo/bNcMoHfxvk0kWtPAfPDRq3EQ/wvbCVLNheaVIphKWMD4/g0' }
  ]
};
