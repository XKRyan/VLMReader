import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './style.css';
import './appearance.css';
import './compact.css';
import App from './App';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}> {
  state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message};}
  render(){return this.state.error?<div className="crash"><h1>页面暂时无法显示</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>重新打开</button></div>:this.props.children;}
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);
