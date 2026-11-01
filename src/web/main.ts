// The bridge goes first: it sets up window.unilink before the React app makes any calls.
import './bridge';
import '../renderer/src/main';
