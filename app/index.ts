import { registerRootComponent } from 'expo';

import App from './App';
// Imported here purely for its module-load side effect: registering the Android
// foreground service and notification channel as early as possible, per Notifee's own
// guidance — see the comment at the top of that file for why.
import './src/lib/clockedInNotification';
// Same idea: expo-task-manager requires its geofencing task to be defined at module
// scope, before the app renders — see the comment at the top of that file.
import './src/lib/locationTracking';
// Same idea again: registers its notification channel eagerly rather than lazily.
import './src/lib/staleShiftReminder';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
