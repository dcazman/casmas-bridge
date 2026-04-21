import { render } from 'preact';
import { App } from './App';
import './styles.css';

history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
render(<App />, document.getElementById('app'));
