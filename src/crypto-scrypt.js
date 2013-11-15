/*
* Copyright (c) 2010-2011 Intalio Pte, All Rights Reserved
* 
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
* 
* The above copyright notice and this permission notice shall be included in
* all copies or substantial portions of the Software.
* 
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
*/
// https://github.com/cheongwy/node-scrypt-js
(function () {

	var MAX_VALUE = 2147483647;
	var workerUrl = null;

	//function scrypt(byte[] passwd, byte[] salt, int N, int r, int p, int dkLen)
	/*
	* N = Cpu cost
	* r = Memory cost
	* p = parallelization cost
	* 
	*/
	window.Crypto_scrypt = function (passwd, salt, N, r, p, dkLen, callback) {
		if (N == 0 || (N & (N - 1)) != 0) throw Error("N must be > 0 and a power of 2");

		if (N > MAX_VALUE / 128 / r) throw Error("Parameter N is too large");
		if (r > MAX_VALUE / 128 / p) throw Error("Parameter r is too large");

		var PBKDF2_opts = { iterations: 1, hasher: Crypto.SHA256, asBytes: true };

		var B = Crypto.PBKDF2(passwd, salt, p * 128 * r, PBKDF2_opts);

		try {
			var i = 0;
			var worksDone = 0;
			var makeWorker = function () {
				if (!workerUrl) {
					var code = '(' + scryptCore.toString() + ')()';
					var blob;
					try {
						blob = new Blob([code], { type: "text/javascript" });
					} catch (e) {
						window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;
						blob = new BlobBuilder();
						blob.append(code);
						blob = blob.getBlob("text/javascript");
					}
					workerUrl = URL.createObjectURL(blob);
				}
				var worker = new Worker(workerUrl);
				worker.onmessage = function (event) {
					var Bi = event.data[0], Bslice = event.data[1];
					worksDone++;

					if (i < p) {
						worker.postMessage([N, r, p, B, i++]);
					}

					var length = Bslice.length, destPos = Bi * 128 * r, srcPos = 0;
					while (length--) {
						B[destPos++] = Bslice[srcPos++];
					}

					if (worksDone == p) {
						callback(Crypto.PBKDF2(passwd, B, dkLen, PBKDF2_opts));
					}
				};
				return worker;
			};
			var workers = [makeWorker(), makeWorker()];
			workers[0].postMessage([N, r, p, B, i++]);
			if (p > 1) {
				workers[1].postMessage([N, r, p, B, i++]);
			}
		} catch (e) {
			window.setTimeout(function () {
				scryptCore();
				callback(Crypto.PBKDF2(passwd, B, dkLen, PBKDF2_opts));
			}, 0);
		}

		// using this function to enclose everything needed to create a worker (but also invokable directly for synchronous use)
		function scryptCore() {
			var XY = [], V = [];

			if (typeof B === 'undefined') {
				onmessage = function (event) {
					var data = event.data;
					var N = data[0], r = data[1], p = data[2], B = data[3], i = data[4];

					var Bslice = [];
					arraycopy32(B, i * 128 * r, Bslice, 0, 128 * r);
					smix(Bslice, 0, r, N, V, XY);

					postMessage([i, Bslice]);
				};
			} else {
				for (var i = 0; i < p; i++) {
					smix(B, i * 128 * r, r, N, V, XY);
				}
			}

			function smix(B, Bi, r, N, V, XY) {
				var Xi = 0;
				var Yi = 128 * r;
				var i;

				arraycopy32(B, Bi, XY, Xi, Yi);

				for (i = 0; i < N; i++) {
					arraycopy32(XY, Xi, V, i * Yi, Yi);
					blockmix_salsa8(XY, Xi, Yi, r);
				}

				for (i = 0; i < N; i++) {
					var j = integerify(XY, Xi, r) & (N - 1);
					blockxor(V, j * Yi, XY, Xi, Yi);
					blockmix_salsa8(XY, Xi, Yi, r);
				}

				arraycopy32(XY, Xi, B, Bi, Yi);
			}

			function blockmix_salsa8(BY, Bi, Yi, r) {
				var X = [];
				var i;

				arraycopy32(BY, Bi + (2 * r - 1) * 64, X, 0, 64);

				for (i = 0; i < 2 * r; i++) {
					blockxor(BY, i * 64, X, 0, 64);
					salsa20_8(X);
					arraycopy32(X, 0, BY, Yi + (i * 64), 64);
				}

				for (i = 0; i < r; i++) {
					arraycopy32(BY, Yi + (i * 2) * 64, BY, Bi + (i * 64), 64);
				}

				for (i = 0; i < r; i++) {
					arraycopy32(BY, Yi + (i * 2 + 1) * 64, BY, Bi + (i + r) * 64, 64);
				}
			}

			function R(a, b) {
				return (a << b) | (a >>> (32 - b));
			}

			function salsa20_8(B) {
				var B32 = new Array(32);
				var x = new Array(32);
				var i;
				var u;
				var x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15;

				for (i = 0; i < 16; i++) {
					B32[i] = (B[i * 4 + 0] & 0xff) << 0;
					B32[i] |= (B[i * 4 + 1] & 0xff) << 8;
					B32[i] |= (B[i * 4 + 2] & 0xff) << 16;
					B32[i] |= (B[i * 4 + 3] & 0xff) << 24;
				}

				arraycopy(B32, 0, x, 0, 16);

				x0  = x[0]  | 0 ;
				x1  = x[1]  | 0 ;
				x2  = x[2]  | 0 ;
				x3  = x[3]  | 0 ;
				x4  = x[4]  | 0 ;
				x5  = x[5]  | 0 ;
				x6  = x[6]  | 0 ;
				x7  = x[7]  | 0 ;
				x8  = x[8]  | 0 ;
				x9  = x[9]  | 0 ;
				x10 = x[10] | 0 ;
				x11 = x[11] | 0 ;
				x12 = x[12] | 0 ;
				x13 = x[13] | 0 ;
				x14 = x[14] | 0 ;
				x15 = x[15] | 0 ;

				for (i = 8; i > 0; i -= 2) {
					 u = (x0  + x12) | 0 ;   x4  ^= (u<<7)  | (u>>>25)
				     u = (x4  + x0 ) | 0 ;   x8  ^= (u<<9)  | (u>>>23)
				     u = (x8  + x4 ) | 0 ;   x12 ^= (u<<13) | (u>>>19)
				     u = (x12 + x8 ) | 0 ;   x0  ^= (u<<18) | (u>>>14)
				     u = (x5  + x1 ) | 0 ;   x9  ^= (u<<7)  | (u>>>25)
				     u = (x9  + x5 ) | 0 ;   x13 ^= (u<<9)  | (u>>>23)
				     u = (x13 + x9 ) | 0 ;   x1  ^= (u<<13) | (u>>>19)
				     u = (x1  + x13) | 0 ;   x5  ^= (u<<18) | (u>>>14)
				     u = (x10 + x6 ) | 0 ;   x14 ^= (u<<7)  | (u>>>25)
				     u = (x14 + x10) | 0 ;   x2  ^= (u<<9)  | (u>>>23)
				     u = (x2  + x14) | 0 ;   x6  ^= (u<<13) | (u>>>19)
				     u = (x6  + x2 ) | 0 ;   x10 ^= (u<<18) | (u>>>14)
				     u = (x15 + x11) | 0 ;   x3  ^= (u<<7)  | (u>>>25)
				     u = (x3  + x15) | 0 ;   x7  ^= (u<<9)  | (u>>>23)
				     u = (x7  + x3 ) | 0 ;   x11 ^= (u<<13) | (u>>>19)
				     u = (x11 + x7 ) | 0 ;   x15 ^= (u<<18) | (u>>>14)
				     u = (x0  + x3 ) | 0 ;   x1  ^= (u<<7)  | (u>>>25)
				     u = (x1  + x0 ) | 0 ;   x2  ^= (u<<9)  | (u>>>23)
				     u = (x2  + x1 ) | 0 ;   x3  ^= (u<<13) | (u>>>19)
				     u = (x3  + x2 ) | 0 ;   x0  ^= (u<<18) | (u>>>14)
				     u = (x5  + x4 ) | 0 ;   x6  ^= (u<<7)  | (u>>>25)
				     u = (x6  + x5 ) | 0 ;   x7  ^= (u<<9)  | (u>>>23)
				     u = (x7  + x6 ) | 0 ;   x4  ^= (u<<13) | (u>>>19)
				     u = (x4  + x7 ) | 0 ;   x5  ^= (u<<18) | (u>>>14)
				     u = (x10 + x9 ) | 0 ;   x11 ^= (u<<7)  | (u>>>25)
				     u = (x11 + x10) | 0 ;   x8  ^= (u<<9)  | (u>>>23)
				     u = (x8  + x11) | 0 ;   x9  ^= (u<<13) | (u>>>19)
				     u = (x9  + x8 ) | 0 ;   x10 ^= (u<<18) | (u>>>14)
				     u = (x15 + x14) | 0 ;   x12 ^= (u<<7)  | (u>>>25)
				     u = (x12 + x15) | 0 ;   x13 ^= (u<<9)  | (u>>>23)
				     u = (x13 + x12) | 0 ;   x14 ^= (u<<13) | (u>>>19)
				     u = (x14 + x13) | 0 ;   x15 ^= (u<<18) | (u>>>14)
				}
				
				x[0] = x0;
				x[1] = x1;
				x[2] = x2;
				x[3] = x3;
				x[4] = x4;
				x[5] = x5;
				x[6] = x6;
				x[7] = x7;
				x[8] = x8;
				x[9] = x9;
				x[10] = x10;
				x[11] = x11;
				x[12] = x12;
				x[13] = x13;
				x[14] = x14;
				x[15] = x15;

				for (i = 0; i < 16; ++i) B32[i] = x[i] + B32[i];

				for (i = 0; i < 16; i++) {
					var bi = i * 4;
					B[bi + 0] = (B32[i] >> 0 & 0xff);
					B[bi + 1] = (B32[i] >> 8 & 0xff);
					B[bi + 2] = (B32[i] >> 16 & 0xff);
					B[bi + 3] = (B32[i] >> 24 & 0xff);
				}
			}

			function blockxor(S, Si, D, Di, len) {
				var i = len >> 6;
				while (i--) {
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];

					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];

					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];

					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];

					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];

					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];

					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];

					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
					D[Di++] ^= S[Si++]; D[Di++] ^= S[Si++];
				}
			}

			function integerify(B, bi, r) {
				var n;

				bi += (2 * r - 1) * 64;

				n = (B[bi + 0] & 0xff) << 0;
				n |= (B[bi + 1] & 0xff) << 8;
				n |= (B[bi + 2] & 0xff) << 16;
				n |= (B[bi + 3] & 0xff) << 24;

				return n;
			}

			function arraycopy(src, srcPos, dest, destPos, length) {
				while (length--) {
					dest[destPos++] = src[srcPos++];
				}
			}

			function arraycopy32(src, srcPos, dest, destPos, length) {
				var i = length >> 5;
				while (i--) {
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];

					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];

					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];

					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
					dest[destPos++] = src[srcPos++]; dest[destPos++] = src[srcPos++];
				}
			}
		} // scryptCore
	}; // window.Crypto_scrypt
})();