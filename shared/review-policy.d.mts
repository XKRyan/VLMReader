import type {Entry,Settings,State,ReviewMode} from '../src/types';
export interface ReviewTask {entryId:string;mode:ReviewMode;due:number;isNew:boolean;learning:boolean;urgency?:number;blocked?:boolean}
export const REVIEW_METHODS:ReviewMode[];
export const METHOD_GAP:number;
export function enabledMethods(settings?:Partial<Settings>):ReviewMode[];
export function totalReviews(entry:Entry):number;
export function isUnreviewed(entry:Entry):boolean;
export function nextReview(entry:Entry,settings?:Partial<Settings>,now?:number):ReviewTask;
export function inNotebook(entry:Entry,scope?:string):boolean;
export function buildReviewQueue(state:State,kind?:string,scope?:string,now?:number):ReviewTask[];
