import { JSDOM } from 'jsdom';


export function newDOM() {
 return new JSDOM(`<!DOCTYPE html><p>Hello world</p>`);
}