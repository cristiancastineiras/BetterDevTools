import { render } from '@solidjs/web';
import App from '../../src/App.tsx';
import '../../src/app.css';

render(() => <App />, document.getElementById('app') ?? document.body);
