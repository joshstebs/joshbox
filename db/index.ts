import {drizzle} from 'drizzle-orm/sqlite-proxy';
import {queryDataService} from '@/lib/data-client.mts';
import * as schema from './schema';
// The external data service has a D1 database. Never connect browser-side.
export function getDb(){return drizzle(queryDataService,{schema});}
