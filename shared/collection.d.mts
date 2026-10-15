import type {Book,Entry,Notebook} from '../src/types';
export function collectionDestination(book:Book|null|undefined,notebooks:Notebook[]):string;
export function collectedEntry(entries:Entry[],text:string,destination:string):Entry|null;
