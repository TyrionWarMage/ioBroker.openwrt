"use strict";

/*
 * Created with @iobroker/create-adapter v1.23.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const request = require("request");

// eslint-disable-next-line no-unused-vars
let tmr_GetValues = null;

let sPass = "";
// Load your modules here, e.g.:
// const fs = require("fs");

class Openwrt extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        // @ts-ignore
        super({
            ...options,
            name: "openwrt",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("objectChange", this.onObjectChange.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    decrypt(key, value) {
        let result = "";
        for (let i = 0; i < value.length; ++i) {
            result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
        }
        this.log.debug("client_secret decrypt ready");
        return result;
    }

    replaceAll(str, find, replace) {
        return str.replace(new RegExp(find, "g"), replace);
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        let bPreCheckErr = false;   //We can't stop the adapter since we need it 4 url and auth check. Make preCheck, if error found don't run main functions 

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);

        this.log.info("##### LOAD CONFIG #####");
        
        //Check refresh interval field, if its's not set, we set it
        if (!Number.isInteger(this.config.inp_refresh)) {
            this.config.inp_refresh = 5;
            this.log.info("Update-Interval overwritten to: " + this.config.inp_refresh.toString());
            //bPreCheckErr = true;   If this is not defined we do it! Dont stop :)
        }
        //Check path field, if it's not set, we dont run
        if (this.config.inp_url.length == 0) {
            this.log.info("## URL emtpy, only Path-Check available");
            bPreCheckErr = true;  //Dont run
        }
        //Check user field, if it's not set, we dont run
        if (this.config.inp_username.length == 0) {
            this.log.info("## User emtpy, only Path-Check available");
            bPreCheckErr = true;  //Dont run
        }

        //Get encrypted Password
        const oConf = await this.getForeignObjectAsync("system.config");
        if (oConf && oConf.native && oConf.native.secret) {
            // @ts-ignore
            sPass = this.decrypt(oConf.native.secret, this.config.inp_password);
        } else {
            sPass = this.decrypt("Zgfr56gFe87jJOM", this.config.inp_password);
        }
        this.log.info("Decrypted the encrypted password!");

        
        this.log.info("##### RUN ADAPTER ##### ");
        if (!bPreCheckErr) {
            //Get first Time Token
            await this.fHTTPGetToken();
            //Then begin Update Timer
            this.fHTTPGetValues();
        }else{
            this.log.info("##### PRE CHECK ERRORS, MAIN FUNCTIONS DISABLED! Check Settings");
        }

        this.subscribeStates("*");

    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info("cleaned everything up...");
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed object changes
     * @param {string} id
     * @param {ioBroker.Object | null | undefined} obj
     */
    onObjectChange(id, obj) {
        if (obj) {
            // The object was changed
            this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            this.log.info(`object ${id} deleted`);
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.message" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    async onMessage(obj) {
        if (typeof obj === "object") {
            //Check if URL Reachable
            if (obj.command === "checkURL") {
                //save Command Result true/false
                const bCheckRes = await this.fHTTPCheckURL(obj.message);
                //send Result back
                if (obj.callback) this.sendTo(obj.from, obj.command, bCheckRes.toString(), obj.callback);
            }

            //Check if AUTH OK
            if (obj.command === "checkAuth") {
                //save Command Result true/false
                const bCheckRes = await this.fHTTPCheckAuth(obj.message);
                //send Result back
                if (obj.callback) this.sendTo(obj.from, obj.command, bCheckRes.toString(), obj.callback);
            }
        }
    }

    fHTTPCheckURL(oCheckVals) {
        return new Promise((resolve) => {
            const oReqOpt = {
                "method": "GET",
                "url": oCheckVals.sURL + "auth"         
            };  

            this.log.info("Called fHTTPCheckURL");
            request(oReqOpt, (error, response, body) => {
                if (error) {
                    this.log.warn("fHTTPCheckURL Unexpected Error: " + error);
                    resolve(false);
                } else { 
                    if (!body.includes("jsonrpc")) {
                        this.log.warn("fHTTPCheckURL 'jsonrpc' not found in response.");
                        resolve(false);
                    } else {
                        this.log.info("fHTTPCheckURL success");
                        resolve(true);
                    }
                }
            });
        });
    }

    fHTTPCheckAuth(oCheckVals) {
        return new Promise((resolve) => {
            const oReqBody = {
                "id": 1,
                "method": "login",
                "params": [oCheckVals.sUser,oCheckVals.sPass]
            };
            const oReqOpt = {
                "method": "GET",
                "url": oCheckVals.sURL + "auth",
                "headers": { "Content-Type": ["application/json", "text/plain"] },
                "body": JSON.stringify(oReqBody)            
            };   
            this.log.info("Called fHTTPCheckAuth");
            request(oReqOpt, (error, response, body) => {
                if (this.fValidateHTTPResult(error,response,"CheckAuth")) {
                    const oBody = JSON.parse(body);
                    if (!oBody.error && oBody.result) {
                        this.log.info("fHTTPCheckAuth success");
                        resolve(true);
                    }else{
                        this.log.info("fHTTPCheckAuth ResultError: " + body);
                        resolve(false);
                    }
                } else {
                    //Log Message printed in fValidateHTTPResult function
                    resolve(false);
                }
                resolve(true);
            });
        });
    }


    async fValidateHTTPResult(error, response, sFuncName) {
        if (error) {
            this.log.warn("##### fHTTP" + sFuncName + " ERROR: " + error.toString());
            return false;  //Error
        } else {
            if (!(response.statusCode == 200)) {
                this.log.info("##### fHTTP" + sFuncName + " HTTPCode: " + response.statusCode);
                if (response.statusCode == 403) {
                    await this.fHTTPGetToken();
                }
                return false;  //Error
            } 
        }

        return true;  //NO Error
    }

    fHTTPGetToken() {  //NOT ASYNC 
        return new Promise((resolve) => {
            const oReqBody = {
                "id": 1,
                "method": "login",
                "params": ["root",sPass]
            };
            const oReqOpt = {
                "method": "GET",
                "url": this.config.inp_url + "auth",
                "headers": { "Content-Type": ["application/json", "text/plain"] },
                "body": JSON.stringify(oReqBody)            
            };  

            this.log.info("Called fHTTGetToken");
            request(oReqOpt, (error, response, body) => {
                if (this.fValidateHTTPResult(error,response,"GetToken")) {
                    const oBody = JSON.parse(body);
                    if (!oBody.error && oBody.result) {
                        this.log.info("Saved new Token: " + oBody.result);
                        this.config.sToken =  oBody.result;
                    }else{
                        this.log.info("##### fHTTPGetToken ResultError: " + body);
                    }
                }
                resolve(true);
            });
        });
    }

    fHTTPGetValues() {
        //Set Timer for next Update
        tmr_GetValues = setTimeout(() =>this.fHTTPGetValues(),this.config.inp_refresh * 1000);

        //GetUptime
        this.fHTTPGetSysinfo();

        //GetHostname
        this.fHTTPGetSysBoard();

        //GetInterfaces
        this.fHTTPGetInterfaces();
    }


    //##################### DATA FUNCTION

    fSetValue2State(sValue, oValues){
        this.setObjectNotExists(oValues.name, {
            type: "state",
            common: oValues,
            native: {}  
        });
        this.setState(oValues.name, sValue);
    }

    fHTTPGetSysinfo() {  //System-Information
        const oReqBody = {
            "method": "exec",
            "params": [ "ubus call system info" ]
        };
        const oReqOpt = {
            "method": "POST",
            "url": this.config.inp_url + "sys?auth="+this.config.sToken,
            "headers": {
                "Content-Type": ["application/json", "text/plain"]
            },
            "body": JSON.stringify(oReqBody)            
        };

        request(oReqOpt, async (error, response, body) => {
            if (await this.fValidateHTTPResult(error,response,"GetSysinfo")) {
                //bug... output \n\t\ seems broken, delete it
                body = this.replaceAll(body,"\n\t","");
                const oBody = JSON.parse(body);
                if (!oBody.error && oBody.result) {
                    const oSysInfo = JSON.parse(oBody.result);
                    if(typeof oSysInfo.uptime != "undefined") this.fSetValue2State(oSysInfo.uptime, { name: "sys.uptime", type: "number", role: "time", read: true, write: false }); 
                    if(typeof oSysInfo.load != "undefined") {
                        this.fSetValue2State(oSysInfo.load[1], { name: "sys.load1M", type: "number", role: "value", read: true, write: false }); 
                        this.fSetValue2State(oSysInfo.load[2], { name: "sys.load5M", type: "number", role: "value", read: true, write: false }); 
                        this.fSetValue2State(oSysInfo.load[3], { name: "sys.load15M", type: "number", role: "value", read: true, write: false });
                    }
                    if(typeof oSysInfo.memory.total != "undefined") this.fSetValue2State(oSysInfo.memory.total, { name: "sys.memory.total", type: "number", role: "value", read: true, write: false }); 
                    if(typeof oSysInfo.memory.free != "undefined") this.fSetValue2State(oSysInfo.memory.free, { name: "sys.memory.free", type: "number", role: "value", read: true, write: false }); 
                    if(typeof oSysInfo.memory.shared != "undefined") this.fSetValue2State(oSysInfo.memory.shared, { name: "sys.memory.shared", type: "number", role: "value", read: true, write: false }); 
                    if(typeof oSysInfo.memory.buffered != "undefined") this.fSetValue2State(oSysInfo.memory.buffered, { name: "sys.memory.buffered", type: "number", role: "value", read: true, write: false }); 
                    if(typeof oSysInfo.swap.total != "undefined") this.fSetValue2State(oSysInfo.swap.total, { name: "sys.swap.total", type: "number", role: "value", read: true, write: false }); 
                    if(typeof oSysInfo.swap.free != "undefined") this.fSetValue2State(oSysInfo.swap.free, { name: "sys.swap.free", type: "number", role: "value", read: true, write: false });
                    //this.fSetValue2State(oBody.result, oSetObj);
                }
            }
        });
    }

    fHTTPGetSysBoard() {  //System-Information
        const oReqBody = {
            "method": "exec",
            "params": [ "ubus call system board" ]
        };
        const oReqOpt = {
            "method": "POST",
            "url": this.config.inp_url + "sys?auth="+this.config.sToken,
            "headers": {
                "Content-Type": ["application/json", "text/plain"]
            },
            "body": JSON.stringify(oReqBody)            
        };

        request(oReqOpt, async (error, response, body) => {
            if (await this.fValidateHTTPResult(error,response,"GetSysBoard")) {
                //bug... output \n\t\ seems broken, delete it
                body = this.replaceAll(body,"\n\t","");
                const oBody = JSON.parse(body);
                if (!oBody.error && oBody.result) {
                    const oSysInfo = JSON.parse(oBody.result);
                    if(typeof oSysInfo.kernel != "undefined") this.fSetValue2State(oSysInfo.kernel, { name: "sys.kernel", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.hostname != "undefined") this.fSetValue2State(oSysInfo.hostname, { name: "sys.hostname", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.system != "undefined") this.fSetValue2State(oSysInfo.system, { name: "sys.system", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.model != "undefined") this.fSetValue2State(oSysInfo.model, { name: "sys.model", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.board_name != "undefined") this.fSetValue2State(oSysInfo.board_name, { name: "sys.board_name", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.release.distribution != "undefined") this.fSetValue2State(oSysInfo.release.distribution, { name: "sys.release.distribution", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.release.version != "undefined") this.fSetValue2State(oSysInfo.release.version, { name: "sys.release.version", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.release.revision != "undefined") this.fSetValue2State(oSysInfo.release.revision, { name: "sys.release.revision", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.release.target != "undefined") this.fSetValue2State(oSysInfo.release.target, { name: "sys.release.target", type: "text", role: "text", read: true, write: false }); 
                    if(typeof oSysInfo.release.description != "undefined") this.fSetValue2State(oSysInfo.release.description, { name: "sys.release.description", type: "text", role: "text", read: true, write: false }); 
                }
            }
        });
    }

    /*
    fHTTPGetHostname() {  //Hostname
        const oReqBody = {
            "method": "hostname"
        };
        const oReqOpt = {
            "method": "POST",
            "url": this.config.inp_url + "sys?auth="+this.config.sToken,
            "headers": {
                "Content-Type": ["application/json", "text/plain"]
            },
            "body": JSON.stringify(oReqBody)            
        };

        request(oReqOpt, async (error, response, body) => {
            if (await this.fValidateHTTPResult(error,response,"GetHostname")) {
                const oBody = JSON.parse(body);
                if (!oBody.error && oBody.result) {
                    const oSetObj = { name: "sys.hostname", type: "text", role: "text", read: true, write: false };
                    this.fSetValue2State(oBody.result, oSetObj);
                }
            }
        });
    }*/

    fHTTPGetInterfaces() {  //Get Interfaces
        const oReqBody = {
            "method": "net.devices"
        };
        const oReqOpt = {
            "method": "POST",
            "url": this.config.inp_url + "sys?auth="+this.config.sToken,
            "headers": {
                "Content-Type": ["application/json", "text/plain"]
            },
            "body": JSON.stringify(oReqBody)            
        };

        request(oReqOpt, async (error, response, body) => {
            if (await this.fValidateHTTPResult(error,response,"GetInterfaces")) {
                const oBody = JSON.parse(body);
                if (!oBody.error && oBody.result) {
                    oBody.result.forEach(oDev => {
                        //eth1.1 would result crappy, we replace . with /
                        oDev = oDev.replace(".","/");
                        const oSetObj = { name: "net.devices." + oDev + ".exists", type: "boolean", role: "indicator", read: true, write: false };
                        this.fSetValue2State(true, oSetObj);
                    });
                }
            }
        });
    }
}



// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Openwrt(options);
} else {
    // otherwise start the instance directly
    new Openwrt();
}
