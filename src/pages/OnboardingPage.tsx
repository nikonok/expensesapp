import OnboardingFlow, { type OnboardingInitialStep } from "../onboarding/OnboardingFlow";

export default function OnboardingPage({
  initialStep,
}: {
  initialStep?: OnboardingInitialStep;
} = {}) {
  return <OnboardingFlow initialStep={initialStep} />;
}
