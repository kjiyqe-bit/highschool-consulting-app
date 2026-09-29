/**
 * ===================================================================
 * 고교 수시 상담센터 웹앱 - 프론트엔드 스크립트 (app.js - Reboot v1)
 * ===================================================================
 * 1단계 핵심:
 * - 구글 시트 연동 상담진 로그인 처리
 * - 성명 + 사번(예: 20260929) 스마트 매칭
 * - 세션 보존 및 화면 전환
 * ===================================================================
 */

// 전역 상태 관리 객체
const state = {
  user: null
};

// DOM 로딩 완료 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  // Lucide 아이콘 렌더링
  if (window.lucide) {
    lucide.createIcons();
  }

  // 기존 로그인 세션 확인 및 복원
  const savedUser = sessionStorage.getItem('consulting_user');
  if (savedUser) {
    try {
      state.user = JSON.parse(savedUser);
      applyUserSession();
    } catch (e) {
      sessionStorage.removeItem('consulting_user');
    }
  }
});

/**
 * 로그인 세션 적용 (화면 전환 및 사용자 정보 표시)
 */
function applyUserSession() {
  const loginModal = document.getElementById('login-modal');
  const appContainer = document.getElementById('app-container');

  if (state.user) {
    // 로그인 모달 숨김, 메인 컨테이너 표시
    if (loginModal) loginModal.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');

    // 헤더 프로필 정보 업데이트
    const headerName = document.getElementById('header-user-name');
    const headerBadge = document.getElementById('header-user-badge');
    const headerEmp = document.getElementById('header-user-emp');

    if (headerName) headerName.textContent = state.user.name;
    if (headerEmp) headerEmp.textContent = `사번: ${state.user.emp_no}`;
    if (headerBadge) {
      headerBadge.textContent = state.user.role_label;
      if (state.user.role === 'admin') {
        headerBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300';
      } else {
        headerBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700 border border-slate-300';
      }
    }

    // 메인 카드 프로필 정보 업데이트
    const cardName = document.getElementById('card-user-name');
    const cardEmp = document.getElementById('card-user-emp');
    const cardRole = document.getElementById('card-user-role');

    if (cardName) cardName.textContent = state.user.name;
    if (cardEmp) cardEmp.textContent = state.user.emp_no;
    if (cardRole) {
      cardRole.textContent = `${state.user.role_label} (${state.user.role === 'admin' ? '전체 관리 및 시트 연동 권한' : '상담 데이터 조회 및 입력 권한'})`;
    }

    if (window.lucide) lucide.createIcons();
  } else {
    // 로그아웃 상태
    if (loginModal) loginModal.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
  }
}

/**
 * 로그인 폼 제출 처리
 */
async function handleLoginSubmit(event) {
  event.preventDefault();

  const nameInput = document.getElementById('login-name');
  const empInput = document.getElementById('login-emp-no');
  const phoneInput = document.getElementById('login-phone');
  const submitBtn = document.getElementById('login-submit-btn');
  const errorBox = document.getElementById('login-error-msg');
  const errorText = document.getElementById('login-error-text');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  const empVal = empInput ? empInput.value.trim() : '';
  const phoneVal = phoneInput ? phoneInput.value.trim() : '';

  if (!nameVal) {
    showError('성명(이름)을 입력해 주세요.');
    return;
  }

  if (!empVal) {
    showError('사번(예시: 20260929)을 입력해 주세요.');
    return;
  }

  // 버튼 로딩 상태 표시
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="animate-pulse">인증 확인 중...</span>`;
  errorBox.classList.add('hidden');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameVal,
        emp_no: empVal,
        phone: phoneVal
      })
    });

    const result = await res.json();

    if (result.success && result.user) {
      state.user = result.user;
      sessionStorage.setItem('consulting_user', JSON.stringify(result.user));
      applyUserSession();
      showToast(`${result.user.name}님 환영합니다! (${result.user.role_label})`, 'success');
    } else {
      showError(result.error || '접근 권한이 없습니다. 성명과 사번을 다시 확인해 주세요.');
    }
  } catch (err) {
    showError('서버 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>인증 및 시스템 접속</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
    if (window.lucide) lucide.createIcons();
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorBox.classList.remove('hidden');
  }
}

/**
 * 로그아웃 처리
 */
function handleLogout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  state.user = null;
  sessionStorage.removeItem('consulting_user');
  applyUserSession();
  showToast('로그아웃 되었습니다.', 'info');
}

/**
 * 심플 토스트 알림
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  const bgColors = {
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
    info: 'bg-slate-800'
  };

  toast.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold text-white flex items-center gap-2 ${bgColors[type] || 'bg-slate-800'}`;
  toast.textContent = message;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
