'use strict';
const fs=require('node:fs/promises');
const {validateHandoverPolicy}=require('../domain/handover-policy');
class FileHandoverPolicyRepository {
  constructor(filePath){this.filePath=filePath;}
  async all(){const raw=JSON.parse(await fs.readFile(this.filePath,'utf8')); return raw.map(validateHandoverPolicy);}
  async getCurrent(){try{return (await this.all()).at(-1)||null;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async getByVersion(version){try{return (await this.all()).find(p=>p.policyVersion===version)||null;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
}
module.exports={FileHandoverPolicyRepository};
