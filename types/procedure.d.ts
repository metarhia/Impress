import { Schema } from 'metaschema';
import { Semaphore } from 'metautil';

import { Application } from './core';

type GroupAccess = { group: string };
type UserAccess = { login: string };
type Access = 'public' | 'session' | 'logged' | GroupAccess | UserAccess;
type QueueParameters = { concurrency: number; size: number; timeout: number };
type Serializer = 'json' | 'v8';
type Protocols = 'http' | 'https' | 'ws' | 'wss';
type AsyncFunction = (...args: Array<any>) => Promise<any>;
type Example = {
  parameters: object;
  returns: object;
};

interface Procedure {
  exports: object;
  script: Function;
  methodName: string;
  application: Application;
  method?: AsyncFunction;
  parameters?: Schema;
  returns?: Schema;
  errors?: Record<string, string>;
  semaphore?: Semaphore;
  caption?: string;
  description?: string;
  access?: Access;
  validate?: Function;
  timeout?: number;
  queue?: QueueParameters;
  serializer?: Serializer;
  protocols?: Array<Protocols>;
  deprecated?: boolean;
  assert?: Function;
  examples?: Array<Example>;
}
