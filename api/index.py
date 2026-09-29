# -*- coding: utf-8 -*-
"""
=============================================================================
고교 수시 상담 관리 웹앱 - Vercel Serverless Function 진입점 (api/index.py)
-----------------------------------------------------------------------------
[1단계 핵심 기능]
1. 구글 스프레드시트 '접근 권한' 시트 실시간 연동
2. 상담진 14명 전원 100% 로그인 보장 (이름 + 사번 매칭)
3. 관리자(라종윤) 및 일반 사용자 권한 자동 구분
4. Vercel 서버리스 표준 규격 (BaseHTTPRequestHandler) 준수
=============================================================================
"""

import http.server
import json
import urllib.request
import urllib.parse
import csv
import io
import os
import re
import uuid
import datetime

# ---------------------------------------------------------------------------
# 1. 구글 스프레드시트 설정 정보
# ---------------------------------------------------------------------------
SPREADSHEET_ID = "1bCdrA4uBZ2wdiwzj5HU8UIHDaGcKeagZGivASk8qcaY"
DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbx5l_GTVJEv0GvneFJBMLyVb1IHwwOvFq3RqJXZqyks3q9L-bpS534s03BJTPwhm8NR/exec"

# ---------------------------------------------------------------------------
# 2. 전화번호 및 사번 정제 함수
# ---------------------------------------------------------------------------
def clean_digits(val):
    """숫자만 추출 (하이픈, 괄호, 공백 제거)"""
    return re.sub(r"[^0-9]", "", str(val or ""))

# ---------------------------------------------------------------------------
# 3. 구글 스프레드시트 실시간 데이터 조회 함수 (GViz CSV API)
# ---------------------------------------------------------------------------
def fetch_sheet_rows(sheet_name_candidates):
    """
    구글 스프레드시트에서 시트명을 기반으로 데이터를 CSV로 안전하게 가져옵니다.
    - 탭 이름에 공백이 있거나 변경되어도 후보군(candidates)을 차례로 시도합니다.
    """
    for sheet_name in sheet_name_candidates:
        encoded = urllib.parse.quote(sheet_name)
        url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet={encoded}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                csv_text = resp.read().decode("utf-8")
                reader = csv.reader(io.StringIO(csv_text))
                rows = list(reader)

                if not rows or len(rows) < 1:
                    continue

                headers = [h.strip() for h in rows[0]]
                records = []
                for row_idx, r in enumerate(rows[1:]):
                    if not any(r):
                        continue
                    item = {"_id": f"row_{row_idx + 1}"}
                    for i, h in enumerate(headers):
                        if not h:
                            continue
                        val = r[i].strip() if i < len(r) else ""
                        item[h] = val
                    records.append(item)

                if records:
                    return records
        except Exception as e:
            continue
    return []

# ---------------------------------------------------------------------------
# 4. Vercel Serverless 요청 핸들러 클래스
# ---------------------------------------------------------------------------
class handler(http.server.BaseHTTPRequestHandler):

    def send_json(self, status_code, data):
        """JSON 표준 응답 생성"""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        """CORS 프리플라이트 요청 처리"""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """GET 요청 처리 (/api/health, /api/data)"""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 1) 서버 헬스체크
        if path.endswith("/health"):
            self.send_json(200, {
                "status": "healthy",
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "step": "1단계: 구글 시트 연동 및 스마트 로그인"
            })
            return

        # 2) 시트 데이터 조회
        if path.endswith("/data") or path.endswith("/access"):
            access_rows = fetch_sheet_rows(["접근 권한", "접근권한", "사용자"])
            self.send_json(200, {
                "success": True,
                "access": access_rows,
                "config": {"apps_script_url": DEFAULT_GAS_URL},
                "total_users": len(access_rows)
            })
            return

        # 기타 경로는 404
        self.send_json(404, {"error": "요청하신 엔드포인트를 찾을 수 없습니다."})

    def do_POST(self):
        """POST 요청 처리 (/api/login)"""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # 요청 본문 읽기
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else ""
        
        try:
            body = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            self.send_json(400, {"success": False, "error": "유효하지 않은 JSON 데이터입니다."})
            return

        # ===================================================================
        # [핵심 로직] 상담진 로그인 인증 API (/api/login)
        # ===================================================================
        if path.endswith("/login") or "login" in path:
            name_input = str(body.get("name", "")).strip()
            emp_input = str(body.get("emp_no", "")).strip()
            phone_input = str(body.get("phone", "")).strip()

            if not name_input:
                self.send_json(400, {"success": False, "error": "성명(이름)을 입력해 주세요."})
                return

            if not emp_input and not phone_input:
                self.send_json(400, {"success": False, "error": "사번(예시: 20260929)을 입력해 주세요."})
                return

            # 실시간 구글 시트 접근 권한 명단 조회
            access_rows = fetch_sheet_rows(["접근 권한", "접근권한", "사용자"])

            clean_input_name = name_input.replace(" ", "")
            clean_input_emp = clean_digits(emp_input)
            clean_input_phone = clean_digits(phone_input)

            matched_user = None

            for row in access_rows:
                row_name = str(row.get("이름", "")).strip()
                row_phone = clean_digits(row.get("휴대폰 번호", ""))
                row_emp = str(row.get("사번", "")).strip()
                row_emp_digits = clean_digits(row_emp)

                # 1) 이름 비교 (공백 제거 유연 비교)
                if not ((row_name == name_input) or (row_name.replace(" ", "") == clean_input_name)):
                    continue

                # 2) 사번 비교 (숫자 정제 또는 원본 비교)
                emp_match = False
                if emp_input and (row_emp == emp_input or (clean_input_emp and row_emp_digits == clean_input_emp)):
                    emp_match = True

                # 3) 휴대폰 번호 비교
                phone_match = False
                if clean_input_phone and row_phone and (clean_input_phone == row_phone):
                    phone_match = True

                # 인증 판정:
                # - 이름이 맞고, 사번이 맞으면 무조건 성공! (시트에 폰 번호가 없는 10명의 선생님도 100% 로그인)
                # - 또는 사번 대신 휴대폰 번호가 일치해도 성공!
                if emp_match or phone_match:
                    # 권한 판별 (D열 "관리자" 여부)
                    raw_auth = str(row.get("관리자") or row.get("권한") or "").strip()
                    if not raw_auth:
                        for k, v in row.items():
                            if k != "_id" and "관리자" in str(v):
                                raw_auth = "관리자"
                                break

                    is_admin = ("관리자" in raw_auth or "admin" in raw_auth.lower())
                    role = "admin" if is_admin else "user"
                    role_label = "관리자" if is_admin else "일반 사용자"

                    matched_user = {
                        "name": row_name,
                        "emp_no": row_emp,
                        "phone": phone_input if phone_input else (row_phone if row_phone else "미등록"),
                        "role": role,
                        "role_label": role_label
                    }
                    break

            if matched_user:
                self.send_json(200, {
                    "success": True,
                    "message": f"{matched_user['name']}님, 인증에 성공하였습니다.",
                    "user": matched_user
                })
            else:
                self.send_json(401, {
                    "success": False,
                    "error": "입력하신 정보와 일치하는 계정을 찾을 수 없습니다. 성명과 사번을 다시 확인해 주세요."
                })
            return

        self.send_json(404, {"success": False, "error": "존재하지 않는 엔드포인트입니다."})
