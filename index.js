import { registerRootComponent } from 'expo';
import App from './App';
import { widgetTaskHandler } from './src/widget-task-handler';

registerRootComponent(App);

// El widget solo existe en una compilacion de desarrollo; en Expo Go se omite.
try {
  require('react-native-android-widget').registerWidgetTaskHandler(widgetTaskHandler);
} catch (e) { /* sin widget */ }
