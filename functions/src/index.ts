/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions";

// 배포 환경에서 Firestore에 접근하는 모듈(user 등)을 위해 default app을 한 번만 초기화한다.
// 테스트는 이 파일을 import하지 않고 *.emulator.test.ts에서 직접 admin.initializeApp()을 호출한다.
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

// Slice 0 (Issue #2): 모듈별 callable function 계약. 각 모듈은 팀원 1명의 병렬 작업 경계다.
export * from "./archive";
export * from "./matching";
export * from "./escort";
export * from "./group";
export * from "./admin";
export * from "./user";
export * from "./scheduled";
