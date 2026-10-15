import type {ReactNode} from 'react';
export default function PageSlot({name,active,children}:{name:string;active:boolean;children:ReactNode}){
  return <section className="page-slot" data-page={name} data-active={active} aria-hidden={!active} inert={!active}>{children}</section>;
}
