import type {Entry,Settings,State,ReviewMode,Notebook} from '../src/types';
export interface ReviewTask {entryId:string;mode:ReviewMode;due:number;isNew:boolean;learning:boolean;urgency?:number;blocked?:boolean}
export const REVIEW_METHODS:ReviewMode[];
export const METHOD_GAP:number;
export function enabledMethods(settings?:Partial<Settings>):ReviewMode[];
export function totalReviews(entry:Entry):number;
export function isUnreviewed(entry:Entry):boolean;
export function nextReview(entry:Entry,settings?:Partial<Settings>,now?:number):ReviewTask;
export function wordlistIds(notebooks?:Notebook[]):Set<string>;
export function isListOnly(entry:Entry,lists:Set<string>):boolean;
export function inferNotebookKind(notebook:Notebook,entries:Entry[]):'personal'|'wordlist';
export function inNotebook(entry:Entry,scope?:string,lists?:Set<string>):boolean;
export function buildReviewQueue(state:State,kind?:string,scope?:string,now?:number):ReviewTask[];
export function reconcileReviewQueue(state:State,queue:ReviewTask[],index:number,kind?:string,scope?:string,now?:number,keepCurrentResult?:boolean):ReviewTask[];
