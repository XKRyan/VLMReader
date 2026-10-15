import type {Mark} from '../src/types';
export function compareAnnotations(a:Partial<Mark>,b:Partial<Mark>,format:string):number;
export interface MarkerAnchor {key:string;ids:string[];draft:boolean;top:number;bottom:number}
export function layoutAnnotationMarkers(items:MarkerAnchor[],height:number,gap?:number):MarkerAnchor[];
