"use client";

import { CredentialDialog } from "./credential-dialog";

interface ApiKeyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

const API_KEYS_URL = "https://opencode.ai/auth";
const AI_PROMPT = [
  "Help me set up an OpenCode Go API key for GitUML.",
  `Use my browser to open ${API_KEYS_URL} and help me create a key in my chosen workspace.`,
  "Explain that generations consume my OpenCode Go subscription limits. Ask before subscribing or adding credits.",
  "Help me paste the key directly into GitUML's OpenCode Go API key dialog. Do not put the key in chat, logs, or files.",
  "If you cannot use my browser, walk me through these steps briefly.",
].join("\n\n");

export function ApiKeyDialog(props: ApiKeyDialogProps) {
  return (
    <CredentialDialog
      {...props}
      credential="opencode_api_key"
      title="OpenCode Go API key"
      description="Generate UML diagrams with DeepSeek V4 Flash Vision Exp on OpenCode Go."
      setup={{
        instructions: (
          <>
            Create a key in your OpenCode workspace with an active Go
            subscription. Generations consume your subscription limits.
          </>
        ),
        url: API_KEYS_URL,
        linkLabel: "Open OpenCode console",
        aiPrompt: AI_PROMPT,
      }}
      dataUsage={
        <>
          Your key is kept in a protected browser cookie for 30 days. Page
          JavaScript cannot read it. GitUML uses it only on the server to
          generate your diagrams.
        </>
      }
    />
  );
}
