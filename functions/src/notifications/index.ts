import * as admin from "firebase-admin";
import {Escort, UserProfile} from "../types";

/**
 * notifications 모듈 — 동행 생명주기 알림(시작/종료) 발송.
 *
 * Slice 8(Issue #10): 카카오 알림톡 발송과 실패 시 SMS 대체를 "스텁"으로 구현한다.
 * 실제 외부 API(카카오 알림톡/SMS)는 호출하지 않는다. 발송 경로는 주입 가능한
 * NotificationGateway로 추상화해, 테스트에서 호출 파라미터 검증과 실패 시 SMS
 * fallback 경로를 확인할 수 있다.
 */

/** 단일 수신자에게 보낼 알림 요청. */
export interface NotificationRequest {
  /** 수신 전화번호(비상연락처). */
  to: string;
  /** 수신자(비상연락처) 이름. */
  name: string;
  /** 발송 메시지 본문. */
  message: string;
}

/** 알림톡/SMS 발송 게이트웨이. 실제 구현은 외부 API를 호출하지 않는 스텁이다. */
export interface NotificationGateway {
  sendAlimtalk(req: NotificationRequest): Promise<void>;
  sendSms(req: NotificationRequest): Promise<void>;
}

/**
 * 기본 게이트웨이 — 실제 외부 API를 호출하지 않는 no-op 스텁(로그만).
 * 배포 환경에서도 외부 호출을 하지 않는다. 실제 연동은 후속 작업에서 교체한다.
 */
const defaultGateway: NotificationGateway = {
  async sendAlimtalk(req: NotificationRequest): Promise<void> {
    console.log(`[alimtalk:stub] to=${req.to} message=${req.message}`);
  },
  async sendSms(req: NotificationRequest): Promise<void> {
    console.log(`[sms:stub] to=${req.to} message=${req.message}`);
  },
};

let gateway: NotificationGateway = defaultGateway;

/**
 * 알림 게이트웨이를 주입한다. null이면 기본 스텁으로 되돌린다(테스트 격리용).
 * @param {NotificationGateway | null} g 사용할 게이트웨이(또는 기본 복원).
 * @return {void}
 */
export function setNotificationGateway(g: NotificationGateway | null): void {
  gateway = g ?? defaultGateway;
}

/** 동행 생명주기 알림 이벤트. */
export type EscortNotificationEvent = "started" | "ended";

/** 이벤트별 메시지 본문. */
const MESSAGES: Record<EscortNotificationEvent, string> = {
  started: "동행이 시작되었습니다.",
  ended: "동행이 종료되었습니다.",
};

/**
 * escort 양측(안내자·탐방자)의 비상연락처를 조회해 알림 대상 목록을 만든다.
 * 사용자 문서가 없거나 비상연락처가 없으면 해당 대상은 건너뛴다(알림은 best-effort).
 * @param {Pick<Escort, "guideId" | "travelerId">} escort 대상 동행.
 * @return {Promise<Array<{phoneNumber: string, name: string}>>} 발송 대상.
 */
async function resolveTargets(
  escort: Pick<Escort, "guideId" | "travelerId">
): Promise<Array<{phoneNumber: string; name: string}>> {
  const db = admin.firestore();
  const snaps = await Promise.all([
    db.collection("users").doc(escort.guideId).get(),
    db.collection("users").doc(escort.travelerId).get(),
  ]);

  const targets: Array<{phoneNumber: string; name: string}> = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const contact = (snap.data() as Omit<UserProfile, "id">).emergencyContact;
    if (contact?.phoneNumber) {
      targets.push({phoneNumber: contact.phoneNumber, name: contact.name});
    }
  }
  return targets;
}

/**
 * 알림톡을 먼저 시도하고, 실패하면 SMS로 대체 발송한다.
 * @param {{phoneNumber: string, name: string}} target 수신 대상.
 * @param {string} message 발송 메시지.
 * @return {Promise<void>} 발송 완료 Promise.
 */
async function sendWithFallback(
  target: {phoneNumber: string; name: string},
  message: string
): Promise<void> {
  const req: NotificationRequest = {
    to: target.phoneNumber,
    name: target.name,
    message,
  };
  try {
    await gateway.sendAlimtalk(req);
  } catch (e) {
    // 알림톡 실패 시 SMS로 대체(US#28: 발송 실패 대비).
    await gateway.sendSms(req);
  }
}

/**
 * 동행 생명주기 이벤트를 양측 비상연락처로 알린다(알림톡 → 실패 시 SMS).
 * 알림은 best-effort이며, 호출부는 이 함수의 실패가 상태 전환을 깨지 않도록
 * try/catch로 감싼다.
 * @param {Pick<Escort, "guideId" | "travelerId">} escort 대상 동행.
 * @param {EscortNotificationEvent} event 시작/종료 이벤트.
 * @return {Promise<void>} 발송 완료 Promise.
 */
export async function notifyEscortLifecycle(
  escort: Pick<Escort, "guideId" | "travelerId">,
  event: EscortNotificationEvent
): Promise<void> {
  const message = MESSAGES[event];
  const targets = await resolveTargets(escort);
  for (const target of targets) {
    await sendWithFallback(target, message);
  }
}

/**
 * 소모임 자동 해산을 멤버 본인 전화번호로 알린다(알림톡 → 실패 시 SMS).
 * 비상연락처가 아닌 멤버 본인에게 발송한다.
 * @param {string[]} memberIds 알림 수신 대상 uid 목록(안내자 본인 제외).
 * @return {Promise<void>} 발송 완료 Promise.
 */
export async function notifyGroupDissolved(memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;
  const db = admin.firestore();
  const snaps = await Promise.all(
    memberIds.map((id) => db.collection("users").doc(id).get())
  );
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const {phoneNumber} = snap.data() as Omit<UserProfile, "id">;
    if (!phoneNumber) continue;
    await sendWithFallback(
      {phoneNumber, name: "소모임원"},
      "소모임이 안내자 자격 상실로 해산되었습니다."
    );
  }
}
