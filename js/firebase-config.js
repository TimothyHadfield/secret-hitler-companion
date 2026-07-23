/* ============================================================================
 * firebase-config.js — which Firebase project this app talks to.
 *
 * These values are PUBLIC BY DESIGN and safe in a public repo: they identify
 * the project, they do not grant access to it. The security boundary is
 * `firestore.rules` (deployed with `firebase deploy --only firestore:rules`),
 * plus the authorised-domains list in the Firebase console — NOT this file.
 *
 * Fetched with:
 *   firebase apps:sdkconfig WEB <appId> --project secret-hitler-companion-th
 * ==========================================================================*/

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDJMe_xxD65sdPlAlAtud4ajb9rHqGsHdU",
  authDomain: "secret-hitler-companion-th.firebaseapp.com",
  projectId: "secret-hitler-companion-th",
  storageBucket: "secret-hitler-companion-th.firebasestorage.app",
  messagingSenderId: "650157163497",
  appId: "1:650157163497:web:eb8c5b5a79b28bf65dc178",
};

// Exposed on window so js/cloud.js (an ES module) can read it without an import,
// keeping this file loadable as a plain script and by Node's require().
if (typeof window !== "undefined") window.FIREBASE_CONFIG = FIREBASE_CONFIG;
if (typeof module !== "undefined" && module.exports) module.exports = FIREBASE_CONFIG;
