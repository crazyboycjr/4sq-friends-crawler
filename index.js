'use strict';

const co = require('co');
const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const util = require('util');
const readline = require('readline');

var logFile = 'done.txt';
var userFile = 'users.txt';
var dataFile = 'data.txt';
var done = '';

function prefixZero(x) {
	let y = x.toString();
	if (x < 10) return '0' + y;
	return y;
}

function getReadStream(filename) {
	try {
		fs.statSync(filename);
	} catch (e) {
		fs.writeFileSync(filename, '', { flags: 'a' });
	}
	return new Promise((resolve, reject) => {
		let readStream = fs.createReadStream(filename);
		readStream.on('error', (e) => reject(e));
		readStream.on('open', () => resolve(readStream));
	});
}

function readDoneFile() {
	return new Promise((resolve, reject) => {
		co(function *() {
			let readStream = yield getReadStream(logFile);
			let rd = readline.createInterface({ input: readStream });
			let done = {};
			let count = 0;
			rd.on('line', (line) => {
				done[line] = true;
				if ((++count & 65535) === 65535)
					console.log(count);
			});
			rd.on('close', () => resolve(done));
		}).catch(onerror);
	});
}

function makequery(param) {
	param['locale'] = 'en';
	param['explicit-lang'] = 'false';
	let date = new Date();
	var datev = date.getFullYear().toString() + prefixZero(date.getMonth() + 1)
		+ prefixZero(date.getDate());
	param['v'] = datev;
	param['limit'] = 197;
	param['m'] = 'foursquare';
	param['wsid'] = 'UMXG1TVJB5TU5FK2THQWZKAITRW1IH';
	param['oauth_token'] = 'QEJ4AQPTMMNB413HGNZ5YDMJSHTOHZHMLZCAQCCLXIX41OMP';
	let url = 'https://api.foursquare.com/v2/users/' + param.id + '/following?' + querystring.stringify(param);
	//console.log(url);
	console.log('User: ' + param.id + ', afterMarker: ', param.afterMarker ? param.afterMarker : '');
	return new Promise((resolve, reject) => {
		let request = https.get(url, (res) => {
			let data = '';
			res.on('data', (chunk) => data += chunk);
			res.on('end', () => {
				resolve(JSON.parse(data));
			});
		}).on('error', reject);
		request.setTimeout(5000, () => { console.log('5000ms time out'); resolve({}); });
	});
}

function getFollowing(userId) {
	return co(function *() {
		let data;
		try {
			data = yield makequery({
				id: userId,
				afterMarker: '',
			});
		} catch (e) {
			//
			console.log(e);
			return;
		}
		if (data && data.meta && data.meta.code === 200) {
			//console.log(JSON.stringify(data));
			let response = data.response;
			let ids = [];
			for (let item of response.following.items)
				ids.push(item.user.id);
			while (response.moreData) {
				data = yield makequery({
					id: userId,
					afterMarker: response.trailingMarker,
				});
				if (!(data && data.meta && data.meta.code === 200)) return;
				response = data.response;
				for (let item of response.following.items)
					ids.push(item.user.id);
			}

			let dataStream = fs.createWriteStream(dataFile, { flags: 'a' });
			let str = userId + ' ' + ids.length;
			for (let id of ids)
				str += ' ' + id;
			dataStream.write(str + '\n');
			dataStream.end();

			done[userId] = true;
			let logStream = fs.createWriteStream(logFile, { flags : 'a' });
			logStream.write(userId + '\n');
			console.log(userId);
			logStream.end();
		} else {
			console.log('userId: ' + userId + ', statusCode: ' + data ? data.meta ? data.meta.code : '' : '');
		}
	});
}

function readUserFile() {
	return new Promise((resolve, reject) => {
		co(function *() {
			let userStream = yield getReadStream(userFile);
			let rd = readline.createInterface({ input: userStream });
			let userIds = [];
			rd.on('line', (line) => {
				if (!done[line]) userIds.push(line);
			});
			rd.on('close', () => {
				console.log('' + userIds.length + ' left in queue.');
				//console.log(userIds);
				resolve(userIds);
			});
		}).catch((e) => reject(e));
	});
}


function timeouter(time) {
	return new Promise((resolve) => {
		setTimeout(resolve('Timeout!'), time);
	});
}

co(function *() {
	done = yield readDoneFile();
	//console.log(done);

	let queue = [];
	let inque = {};
	let userIds = yield readUserFile();;
	const concurNum = 100;

	for (let i in userIds) {
		if (!done[userIds[i]] && !inque[userIds[i]]) {
			queue.push(getFollowing(userIds[i]));
			inque[userIds[i]] = true;
		}
		if (i % concurNum == concurNum - 1) {
			let start = new Date;
			console.log('queue.length: ' + queue.length);
			console.log('Start time: ' + start);
			yield Promise.all(queue);
			queue.length = 0;
			console.log('End time: ' + new Date);
		}
	}
});

function onerror(err)  {
	console.error(err.stack);
}
process.on('uncaughtException', e => console.error(e.stack));
process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise ', p, ' reason: ', reason);
});
