import {useEffect,useRef,useState} from 'react';
import type {Settings,SpeechEvent} from './types';
type Status='idle'|'loading'|'playing'|'paused';
export function useSpeech(settings:Settings,onError:(msg:string)=>void,onFinished?:()=>void,onBuffered?:()=>void){
  const [status,setStatus]=useState<Status>('idle'),[currentText,setCurrentText]=useState(''),[progress,setProgress]=useState({time:0,end:0,done:false});
  const audio=useRef<HTMLAudioElement|null>(null),session=useRef(''),cleanup=useRef<(()=>void)|null>(null),resume=useRef<(()=>void)|null>(null);
  const current=useRef(settings);current.current=settings;
  const finished=useRef(onFinished);finished.current=onFinished;
  const buffered=useRef(onBuffered);buffered.current=onBuffered;
  const wantsPlay=useRef(false);
  function stop(){
    const old=session.current;session.current='';wantsPlay.current=false;
    cleanup.current?.();cleanup.current=null;audio.current=null;resume.current=null;
    if(old)void window.mem.cancelSpeech(old).catch(()=>{});setStatus('idle');setCurrentText('');setProgress({time:0,end:0,done:false});
  }
  function start(text:string){
    stop();if(!text.trim()){onError('这页没有可朗读的文字');return;}
    const id=crypto.randomUUID();session.current=id;wantsPlay.current=true;setStatus('loading');setCurrentText(text.slice(0,160));
    const player=new Audio();audio.current=player;player.preload='auto';player.preservesPitch=true;
    // Loading media resets playbackRate to defaultPlaybackRate, so set both and reapply once playing.
    const applyRate=()=>{const rate=current.current.rate;player.defaultPlaybackRate=rate;if(player.playbackRate!==rate)player.playbackRate=rate;};applyRate();
    const streaming=typeof MediaSource!=='undefined'&&MediaSource.isTypeSupported('audio/mpeg');
    const media=streaming?new MediaSource():null;let source:SourceBuffer|null=null,url='',done=false,started=false,starting=false,disposed=false;
    const chunks:Uint8Array<ArrayBuffer>[]=[],cues:{start:number;text:string}[]=[];
    const active=()=>!disposed&&session.current===id;
    const fail=(error:string)=>{if(active()){stop();onError(error);}};
    const remaining=()=>player.buffered.length?Math.max(0,player.buffered.end(player.buffered.length-1)-player.currentTime):0;
    const report=()=>{if(active())setProgress({time:player.currentTime,end:player.buffered.length?player.buffered.end(player.buffered.length-1):0,done});};
    function maybePlay(){
      if(!active()||!wantsPlay.current||starting||!player.paused)return;
      // Buffer enough for fast playback as well; sentence boundaries share one
      // media timeline instead of recreating an audio element for every chunk.
      if(!done&&remaining()<Math.max(3,4*current.current.rate))return;
      if(!remaining()&&player.readyState<2)return;
      starting=true;void player.play().then(()=>{starting=false;if(active())setStatus('playing');}).catch(()=>{starting=false;fail('语音播放失败，请重试');});
    }
    function pump(){
      if(!active()||!media||!source||source.updating||media.readyState!=='open')return;
      try{
        if(chunks.length){source.appendBuffer(chunks.shift()!);return;}
        if(done)media.endOfStream();maybePlay();
      }catch(error){fail('朗读失败：'+(error as Error).message);}
    }
    player.onplaying=()=>{if(active()){applyRate();started=true;setStatus('playing');}};player.onloadedmetadata=applyRate;
    player.onwaiting=()=>{if(active()&&started&&wantsPlay.current){player.pause();setStatus('loading');maybePlay();}};
    player.oncanplay=maybePlay;
    player.ontimeupdate=()=>{if(active()){const cue=cues.findLast(c=>c.start<=player.currentTime);if(cue)setCurrentText(cue.text);report();}};player.onprogress=report;
    player.onerror=()=>fail('语音播放失败，请重试');
    player.onended=()=>{if(active()){session.current='';wantsPlay.current=false;cleanup.current?.();cleanup.current=null;audio.current=null;resume.current=null;setStatus('idle');setCurrentText('');setProgress({time:0,end:0,done:false});finished.current?.();}};
    const off=window.mem.onSpeech((event:SpeechEvent)=>{
      if(!active()||event.id!==id)return;
      if(event.type==='error'){fail('朗读失败：'+event.error);return;}
      if(event.type==='cue'){cues.push({start:event.start||0,text:event.text||''});return;}
      if(event.type==='chunk'&&event.data){chunks.push(Uint8Array.from(atob(event.data),c=>c.charCodeAt(0)));pump();}
      if(event.type==='end'){
        done=true;buffered.current?.();report();
        if(media){pump();maybePlay();}
        else{url=URL.createObjectURL(new Blob(chunks,{type:'audio/mpeg'}));chunks.length=0;player.src=url;player.load();}
      }
    });
    if(media){
      url=URL.createObjectURL(media);player.src=url;
      media.addEventListener('sourceopen',()=>{if(!active())return;try{source=media.addSourceBuffer('audio/mpeg');source.mode='sequence';source.addEventListener('updateend',()=>{pump();maybePlay();report();});source.addEventListener('error',()=>fail('语音播放失败，请重试'));pump();}catch(error){fail('朗读失败：'+(error as Error).message);}},{once:true});
    }
    cleanup.current=()=>{disposed=true;off();player.onended=player.onerror=player.onwaiting=player.onplaying=player.oncanplay=player.ontimeupdate=player.onprogress=player.onloadedmetadata=null;player.pause();player.removeAttribute('src');player.load();if(url)URL.revokeObjectURL(url);};
    resume.current=maybePlay;
    void window.mem.startSpeech(id,text,current.current.enVoice,current.current.zhVoice).catch(error=>fail('朗读失败：'+error.message));
  }
  // Seeking is limited to audio that has already been generated.
  function seek(time:number){
    const player=audio.current;if(!player||!player.buffered.length)return;
    const end=player.buffered.end(player.buffered.length-1);player.currentTime=Math.max(0,Math.min(time,Math.max(0,end-0.05)));
    setProgress(previous=>({...previous,time:player.currentTime}));
  }
  function toggle(text:string){
    if(status==='playing'){wantsPlay.current=false;audio.current?.pause();setStatus('paused');}
    else if(status==='paused'){wantsPlay.current=true;setStatus('loading');resume.current?.();}
    else if(status!=='loading')start(text);
  }
  useEffect(()=>{const player=audio.current;if(player){player.defaultPlaybackRate=settings.rate;player.playbackRate=settings.rate;}},[settings.rate]);
  useEffect(()=>()=>{const old=session.current;session.current='';cleanup.current?.();if(old)void window.mem.cancelSpeech(old).catch(()=>{});},[]);
  return {status,currentText,progress,start,stop,toggle,seek};
}
