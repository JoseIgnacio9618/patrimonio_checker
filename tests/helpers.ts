import type { Transaction } from '../shared/types.js';
let seq=0;
export const tx=(data:Partial<Transaction>):Transaction=>({id:`test:${++seq}`,date:'2026-01-01',type:'DEPOSIT',asset:'',name:'',category:'OTHER',quantity:'0',amount:'0',fee:'0',tax:'0',currency:'EUR',costBasis:null,note:'',...data});
