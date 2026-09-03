// firebase-messaging-sw.js
// MUST be served from the site ROOT (e.g. https://yourapp.com/firebase-messaging-sw.js)
// — Firebase's default service worker scope requires this exact path/location.
//
// This is what actually shows the OS notification when a push arrives while
// the Kashish tab/app is closed or in the background. The Cloudflare Worker
// (see /cloudflare-worker) is what SENDS that push, on a cron schedule.

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// Same config as in kashish.html — keep these two in sync.
firebase.initializeApp({
  apiKey: "AIzaSyC30TcmMVhP_8HdFYS1WufRiZwSDYNMTF0",
  authDomain: "pulse2-92372.firebaseapp.com",
  projectId: "pulse2-92372",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID",
});

const messaging = firebase.messaging();

// Background message handler — fires when a push arrives and the app isn't
// in the foreground. The Worker sends `notification` fields directly, so
// most browsers will show this automatically, but handling it explicitly
// here guarantees consistent behavior (and works with data-only messages).
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Kashish reminder';
  const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.text) || '';
  self.registration.showNotification(title, {
    body,
    icon: '/icon.png', // optional — replace with your app icon path, or remove this line
    tag: (payload.data && payload.data.reminderId) || 'kashish-reminder',
  });
});

// Tapping the notification focuses/opens the app instead of just dismissing.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
