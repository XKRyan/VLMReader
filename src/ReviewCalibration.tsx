import {useState} from 'react';

// Fits the forgetting curve to this learner's own review history. Everything runs
// locally; the default curve is kept unless the fit clearly wins.
type Report = {status:'fitted'|'no_gain'|'insufficient';samples:number;needed?:number;decay:number;defaultDecay:number;fittedDecay:number;improvement?:number};

export default function ReviewCalibration(){
  const [busy,setBusy]=useState(false),[report,setReport]=useState<Report|null>(null),[error,setError]=useState('');
  async function run(){
    setBusy(true);setError('');
    try{setReport(await window.mem.calibrateReview() as Report);}
    catch(failure){setError((failure as Error).message);}
    finally{setBusy(false);}
  }
  const summary=!report?'用你自己的复习记录拟合遗忘曲线；数据不足或没有更优时保持默认。'
    :report.status==='fitted'?`已校准：遗忘速度 ${report.decay}（默认 ${report.defaultDecay}），用了 ${report.samples} 条间隔复习记录。`
    :report.status==='insufficient'?`还需要更多间隔复习记录：现有 ${report.samples} 条，至少 ${report.needed} 条。`
    :`你的记录与默认曲线很接近，保持默认（${report.samples} 条记录）。`;
  return <div className="setting-row"><div><strong>校准记忆曲线</strong><small>{summary}</small>{error&&<small className="error-text">{error}</small>}</div><button type="button" className="secondary compact" disabled={busy} onClick={()=>void run()}>{busy?'校准中…':'开始校准'}</button></div>;
}
