export type LinkedAccountStatus = 'draft' | 'created' | 'details_submitted' | 'verification_pending'
  | 'verification_failed' | 'manual_review' | 'activation_pending' | 'active' | 'declined';

export type ProviderAccountId = `org_${string}`;
export type LifecycleEvent =
  | { type: 'created'; providerAccountId: ProviderAccountId }
  | { type: 'details_submitted' }
  | { type: 'verification_link_issued'; expiresAt: Date }
  | { type: 'verification_passed' }
  | { type: 'verification_failed'; reason: string }
  | { type: 'activation_requested' }
  | { type: 'activated'; wallet: { number: string; name: string } | null }
  | { type: 'declined'; reason: string }
  | { type: 'payment_methods_requested' };

export type LinkedAccountState = {
  status: LinkedAccountStatus;
  providerAccountId: ProviderAccountId | null;
  attempts: number;
  verificationExpiresAt: Date | null;
  walletOnly: boolean;
  activationRequested: boolean;
  declineReason: string | null;
  paymentMethodsRequested: boolean;
};

export type NextAction = 'create' | 'submit_details' | 'issue_verification_link' | 'await_verification'
  | 'reissue_verification_link' | 'activate' | 'await_activation' | 'request_payment_methods'
  | 'await_manual_review' | 'none';

export const MAX_VERIFICATION_ATTEMPTS = 3;

export function initialState(): LinkedAccountState {
  return {
    status: 'draft',
    providerAccountId: null,
    attempts: 0,
    verificationExpiresAt: null,
    walletOnly: false,
    activationRequested: false,
    declineReason: null,
    paymentMethodsRequested: false,
  };
}

export function applyEvent(state: LinkedAccountState, event: LifecycleEvent): LinkedAccountState {
  if (state.status === 'declined') return state;
  switch (event.type) {
    case 'created':
      return state.status === 'draft'
        ? { ...state, status: 'created', providerAccountId: event.providerAccountId } : state;
    case 'details_submitted':
      return state.status === 'created' ? { ...state, status: 'details_submitted' } : state;
    case 'verification_link_issued':
      return state.status === 'details_submitted' || state.status === 'verification_failed'
        || (state.status === 'verification_pending' && state.verificationExpiresAt?.getTime() !== event.expiresAt.getTime())
        ? { ...state, status: 'verification_pending', verificationExpiresAt: event.expiresAt } : state;
    case 'verification_passed':
      return state.status === 'verification_pending' || state.status === 'verification_failed' || state.status === 'manual_review'
        ? { ...state, status: 'activation_pending', verificationExpiresAt: null, walletOnly: false } : state;
    case 'verification_failed': {
      if (state.status !== 'verification_pending') return state;
      const attempts = state.attempts + 1;
      const exhausted = attempts >= MAX_VERIFICATION_ATTEMPTS;
      return { ...state, attempts, status: exhausted ? 'manual_review' : 'verification_failed',
        verificationExpiresAt: null, walletOnly: exhausted };
    }
    case 'activation_requested':
      return state.status === 'activation_pending' && !state.activationRequested
        ? { ...state, activationRequested: true } : state;
    case 'activated':
      return state.providerAccountId && state.status !== 'active'
        ? { ...state, status: 'active', verificationExpiresAt: null, walletOnly: state.status === 'manual_review' } : state;
    case 'declined':
      return { ...state, status: 'declined', declineReason: event.reason, verificationExpiresAt: null };
    case 'payment_methods_requested':
      return state.status === 'active' && !state.paymentMethodsRequested
        ? { ...state, paymentMethodsRequested: true } : state;
  }
}

export function nextAction(state: LinkedAccountState, now: Date): NextAction {
  switch (state.status) {
    case 'draft': return 'create';
    case 'created': return 'submit_details';
    case 'details_submitted': return 'issue_verification_link';
    case 'verification_pending':
      return state.verificationExpiresAt && state.verificationExpiresAt > now
        ? 'await_verification' : 'reissue_verification_link';
    case 'verification_failed': return 'reissue_verification_link';
    case 'manual_review': return 'await_manual_review';
    case 'activation_pending': return state.activationRequested ? 'await_activation' : 'activate';
    case 'active': return state.paymentMethodsRequested || state.walletOnly ? 'none' : 'request_payment_methods';
    case 'declined': return 'none';
  }
}
