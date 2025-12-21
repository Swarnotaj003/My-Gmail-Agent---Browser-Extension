// My Gmail Agent - Content Script
// Functionality: Generates AI-powered email replies by extracting email content from DOM and calling backend API.

(function () {
  const SIDEBAR_ID = "myga-sidebar";
  const FAB_ID = "myga-fab";
  
  // Valid tones for reply generation
  const VALID_TONES = ["Formal", "Courteous", "Concise", "Casual", "Empathetic"];

  // Detect current Gmail context
  function detectContext() {
    const url = window.location.href;
    
    // Check if we're viewing a thread (email is open)
    // Gmail thread URL pattern: #inbox/[threadId] where threadId is alphanumeric
    
    const threadMatch = url.match(/#inbox\/([A-Za-z0-9]+)$/);
    if (threadMatch && threadMatch[1]) {
      return "thread";
    }
    
    // Check if compose window is open
    if (url.includes("?compose=")) {
      return "inbox";
    }
    
    // Otherwise, we're in inbox view
    return "inbox";
  }

  // Extract email content from Gmail DOM
  function extractEmailContent() {
    try {
      // Gmail uses role="main" for the main content area
      const emailBody = document.querySelector('[role="main"]');
      if (!emailBody) {
        console.warn("Could not find email body in DOM");
        return null;
      }

      // Find subject line
      let subject = "";
      const subjectElement = emailBody.querySelector('[data-subject]');
      if (subjectElement) {
        subject = subjectElement.getAttribute('data-subject') || subjectElement.textContent || "";
      } else {
        // Fallback: look for subject in heading
        const headingElement = emailBody.querySelector('h2');
        subject = headingElement ? headingElement.textContent : "";
      }

      // Find email content - Gmail stores message content in specific containers
      let content = "";
      const messageBody = emailBody.querySelector('[data-message-id]') || emailBody.querySelector('.aO.T-I-J3');
      if (messageBody) {
        content = messageBody.textContent || messageBody.innerText || "";
      } else {
        // Fallback: extract all visible text from main area
        content = emailBody.innerText || emailBody.textContent || "";
      }

      // Clean up content
      subject = subject.trim();
      content = content.trim().substring(0, 2000); // Limit to 2000 chars to avoid token limits

      if (!subject || !content) {
        console.warn("Subject or content is empty. Subject:", subject, "Content length:", content.length);
        return null;
      }

      return { subject, content };
    } catch (error) {
      console.error("Error extracting email content:", error);
      return null;
    }
  }

  // Call backend API via background script to avoid CORS issues
  async function callGenerateReplyAPI(emailData, tone) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          reject(new Error("Chrome runtime is not available. Extension may not be properly initialized."));
          return;
        }

        chrome.runtime.sendMessage(
          {
            action: "generateReply",
            emailData: emailData,
            tone: tone,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("Chrome runtime error:", chrome.runtime.lastError);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            if (!response) {
              reject(new Error("No response from background script."));
              return;
            }

            if (response.success) {
              resolve(response.reply);
            } else {
              reject(new Error(response.error || "Unknown error from background script."));
            }
          }
        );
      } catch (error) {
        console.error("Error sending message to background script:", error);
        reject(error);
      }
    });
  }

  // Inject generated reply into Gmail compose box
  function injectReplyIntoCompose(generatedReply) {
    try {
      console.log("Attempting to inject reply into compose box...");
      
      // Try multiple selector patterns for Gmail compose area
      const selectors = [
        '[aria-label="Message Body"]',           // Standard compose area
        '[role="textbox"]',                      // Fallback: generic textbox
        '[contenteditable="true"]',              // Any contenteditable element
        '.editable',                             // Gmail's editable class
        '[data-tooltip="Message Body"]',         // Alternative aria-label
      ];

      let composeArea = null;
      let foundSelector = null;

      // Try each selector
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        console.log(`Selector "${selector}" found ${elements.length} element(s)`);
        
        if (elements.length > 0) {
          // Find the most relevant element (usually the last one in compose)
          for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i];
            // Check if element is visible and not hidden
            if (el.offsetHeight > 0 && el.offsetWidth > 0) {
              composeArea = el;
              foundSelector = selector;
              break;
            }
          }
          if (composeArea) break;
        }
      }

      if (!composeArea) {
        console.warn("Could not find any compose area element");
        console.warn("Available elements in page:");
        
        // Log all contenteditable elements for debugging
        document.querySelectorAll('[contenteditable="true"]').forEach((el, idx) => {
          console.log(`  [${idx}] contenteditable: visible=${el.offsetHeight > 0}, class=${el.className}, role=${el.getAttribute('role')}`);
        });
        
        return false;
      }

      console.log(`Found compose area using selector: ${foundSelector}`);
      console.log("Compose area element:", composeArea);
      console.log("Compose area is visible:", composeArea.offsetHeight > 0);

      // Create a temporary container to preserve formatting
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = generatedReply.replace(/\n/g, "<br>");
      
      console.log("Generated reply preview:", generatedReply.substring(0, 100) + "...");

      // Insert the reply into compose area
      composeArea.innerHTML = tempDiv.innerHTML;
      
      console.log("Reply inserted into compose area");

      // Trigger input event to notify Gmail of changes
      const inputEvent = new Event("input", { bubbles: true });
      composeArea.dispatchEvent(inputEvent);
      
      const changeEvent = new Event("change", { bubbles: true });
      composeArea.dispatchEvent(changeEvent);

      // Also trigger contenteditable-specific events
      if (composeArea.isContentEditable) {
        const keyEvent = new KeyboardEvent("keydown", { bubbles: true });
        composeArea.dispatchEvent(keyEvent);
      }

      console.log("Events dispatched");
      return true;
    } catch (error) {
      console.error("Error injecting reply into compose:", error);
      console.error("Stack:", error.stack);
      return false;
    }
  }

  // Show status message in sidebar
  function showStatusMessage(message, type = "info") {
    const statusContainer = document.getElementById("myga-status-message");
    if (statusContainer) {
      statusContainer.textContent = message;
      statusContainer.className = `myga-status-message myga-status-${type}`;
      statusContainer.style.display = "block";
    }
  }

  function initWhenGmailReady() {
    // Only run on Gmail
    if (!/mail\.google\.com$/.test(window.location.hostname)) return;

    // Remove old UI if exists (for context switching)
    const oldSidebar = document.getElementById(SIDEBAR_ID);
    const oldFab = document.getElementById(FAB_ID);
    if (oldSidebar) oldSidebar.remove();
    if (oldFab) oldFab.remove();

    createFloatingButton();
    createSidebar();
  }

  function createFloatingButton() {
    const fab = document.createElement("button");
    fab.id = FAB_ID;
    fab.type = "button";
    fab.className = "myga-fab";
    fab.title = "Open My Gmail Agent";
    fab.innerHTML = "🤖";

    fab.addEventListener("click", toggleSidebar);
    document.body.appendChild(fab);
  }

  function createSidebar() {
    const sidebar = document.createElement("div");
    sidebar.id = SIDEBAR_ID;
    sidebar.className = "myga-sidebar myga-hidden";

    const context = detectContext();
    let contentHTML = "";

    if (context === "thread") {
      contentHTML = `
        <div class="myga-sidebar-inner">
          <header class="myga-header">
            <div class="myga-header-title">
              <span class="myga-logo">🤖</span>
              <div>
                <div class="myga-title">My Gmail Agent</div>
                <div class="myga-subtitle">Thread tools</div>
              </div>
            </div>
            <button class="myga-icon-button" type="button" data-myga-action="close-sidebar" aria-label="Close sidebar">✕</button>
          </header>

          <div id="myga-status-message" class="myga-status-message" style="display: none;"></div>

          <section class="myga-section">
            <h2 class="myga-section-title">Generate reply</h2>
            <p class="myga-section-desc">
              Draft a context-aware reply for the email you're reading. Keep reply compose box open.
            </p>
            <div class="myga-field-group">
              <label class="myga-label">Desired tone</label>
              <div class="myga-chip-row" id="myga-tone-selector">
                <button class="myga-chip myga-chip--selected" type="button" data-tone="Formal">Formal</button>
                <button class="myga-chip" type="button" data-tone="Courteous">Courteous</button>
                <button class="myga-chip" type="button" data-tone="Concise">Concise</button>
                <button class="myga-chip" type="button" data-tone="Casual">Casual</button>
                <button class="myga-chip" type="button" data-tone="Empathetic">Empathetic</button>
                <button class="myga-chip" type="button" data-tone="Rigid">Rigid</button>
              </div>
            </div>

            <button class="myga-primary-button" type="button" id="myga-generate-button">
              Generate reply
            </button>
          </section>

          <section class="myga-section">
            <h2 class="myga-section-title">Summarize thread</h2>
            <p class="myga-section-desc">
              Get a quick AI-generated summary of this email thread.
            </p>
            <div class="myga-field-group">
              <label class="myga-label">Summary style</label>
              <div class="myga-chip-row" id="myga-summary-style-selector">
                <button class="myga-chip myga-chip--selected" type="button" data-style="Short">Short</button>
                <button class="myga-chip" type="button" data-style="BulletPoints">Bullet points</button>
                <button class="myga-chip" type="button" data-style="Detailed">Detailed</button>
              </div>
            </div>
            <button class="myga-primary-button" type="button" id="myga-summarize-button">
              Summarize thread
            </button>
          </section>

        </div>
      `;
    } else {
      // Inbox context
      contentHTML = `
        <div class="myga-sidebar-inner">
          <header class="myga-header">
            <div class="myga-header-title">
              <span class="myga-logo">🤖</span>
              <div>
                <div class="myga-title">My Gmail Agent</div>
                <div class="myga-subtitle">Inbox tools</div>
              </div>
            </div>
            <button class="myga-icon-button" type="button" data-myga-action="close-sidebar" aria-label="Close sidebar">✕</button>
          </header>

          <section class="myga-section">
            <h2 class="myga-section-title">Smart search</h2>
            <p class="myga-section-desc">
              Find emails using natural language or AI-powered queries.
            </p>
            <div class="myga-info-box">
              <span class="myga-badge-coming-soon">COMING SOON</span>
              <p class="myga-info-text">This feature is coming soon. Stay tuned!</p>
            </div>
          </section>
        </div>
      `;
    }

    sidebar.innerHTML = contentHTML;

    sidebar.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.dataset.mygaAction === "close-sidebar") {
        hideSidebar();
      }

      // Handle tone selection
      if (target.classList.contains("myga-chip") && target.dataset.tone) {
        const toneButtons = document.querySelectorAll("#myga-tone-selector .myga-chip");
        toneButtons.forEach(btn => btn.classList.remove("myga-chip--selected"));
        target.classList.add("myga-chip--selected");
      }

      //Handle summary style selection
      if (target.classList.contains("myga-chip") && target.dataset.style) {
        const styleButtons = document.querySelectorAll("#myga-summary-style-selector .myga-chip");
        styleButtons.forEach((btn) => btn.classList.remove("myga-chip--selected"));
        target.classList.add("myga-chip--selected");
      }

      // Handle generate reply button
      if (target.id === "myga-generate-button") {
        handleGenerateReply();
      }

      // Handle summarize thread button
      if (target.id === "myga-summarize-button") {
        handleSummarizeThread();
      }

    });

    document.body.appendChild(sidebar);
  }

  async function handleGenerateReply() {
    try {
      const generateButton = document.getElementById("myga-generate-button");
      const selectedToneButton = document.querySelector("#myga-tone-selector .myga-chip--selected");
      
      if (!selectedToneButton) {
        showStatusMessage("Please select a tone", "error");
        return;
      }

      const tone = selectedToneButton.dataset.tone;

      // Show loading state
      generateButton.disabled = true;
      generateButton.textContent = "Generating...";
      showStatusMessage("Extracting email content...", "info");

      // Extract email content
      const emailData = extractEmailContent();
      if (!emailData) {
        showStatusMessage("Could not extract email content. Please make sure you're viewing an email.", "error");
        generateButton.disabled = false;
        generateButton.textContent = "Generate reply";
        return;
      }

      console.log("Email data extracted:", {
        subjectLength: emailData.subject.length,
        contentLength: emailData.content.length
      });

      showStatusMessage("Calling AI API...", "info");

      // Call API with tone parameter
      const reply = await callGenerateReplyAPI(emailData, tone);

      showStatusMessage("Injecting reply into compose box...", "info");

      // Inject reply
      const injected = injectReplyIntoCompose(reply);
      
      if (injected) {
        showStatusMessage("✓ Reply generated successfully! Check your compose box.", "success");
      } else {
        showStatusMessage(
          "⚠ Reply generated but couldn't auto-inject. Make sure reply compose box is open, OR Copy from browser console.",
          "warning"
        );
        console.log("=== GENERATED REPLY (Copy this) ===\n", reply, "\n=== END REPLY ===");
      }

      generateButton.disabled = false;
      generateButton.textContent = "Generate reply";
    } catch (error) {
      console.error("Generate reply error:", error);
      
      let errorMessage = error.message;
      if (error.message.includes("Failed to connect")) {
        errorMessage = "Backend server is not running. Please start the backend at http://localhost:8080";
      }
      
      showStatusMessage(`Error: ${errorMessage}`, "error");
      
      const generateButton = document.getElementById("myga-generate-button");
      generateButton.disabled = false;
      generateButton.textContent = "Generate reply";
    }
  }

  function toggleSidebar() {
    const sidebar = document.getElementById(SIDEBAR_ID);
    if (!sidebar) return;

    if (sidebar.classList.contains("myga-hidden")) {
      showSidebar();
    } else {
      hideSidebar();
    }
  }

  function showSidebar() {
    const sidebar = document.getElementById(SIDEBAR_ID);
    const fab = document.getElementById(FAB_ID);
    if (!sidebar || !fab) return;

    sidebar.classList.remove("myga-hidden");
    fab.classList.add("myga-fab--active");
  }

  function hideSidebar() {
    const sidebar = document.getElementById(SIDEBAR_ID);
    const fab = document.getElementById(FAB_ID);
    if (!sidebar || !fab) return;

    sidebar.classList.add("myga-hidden");
    fab.classList.remove("myga-fab--active");
  }

  // ===== Summary feature (new) =====

  // Extract full thread text for summarization
  function extractThreadText() {
    // Gmail renders message bodies inside elements with class .a3s
    const bodies = Array.from(document.querySelectorAll('.a3s'))
      .map(div => (div.innerText || "").trim())
      .filter(Boolean);

    const fullText = bodies.join("\n\n").trim();
    return fullText;
  }

  // Call background to summarize (avoids CORS)
  async function callSummarizeAPI(threadText) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          reject(new Error("Chrome runtime is not available. Extension may not be properly initialized."));
          return;
        }

        chrome.runtime.sendMessage(
          { action: "summarizeEmail", emailContent: threadText },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("Chrome runtime error:", chrome.runtime.lastError);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response) {
              reject(new Error("No response from background script."));
              return;
            }
            if (response.success) {
              resolve(response.summary);
            } else {
              reject(new Error(response.error || "Unknown error from background script."));
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  // Render summary in a floating box (non-intrusive)
  function showSummaryOutput(summaryText) {
    const existingBox = document.getElementById('summary-output-box');
    if (existingBox) existingBox.remove();

    const outputBox = document.createElement('div');
    outputBox.id = 'summary-output-box';
    outputBox.className = 'myga-summary-box';

    outputBox.style.position = 'fixed';
    outputBox.style.bottom = '20px';
    outputBox.style.right = '20px';
    outputBox.style.background = '#fff';
    outputBox.style.border = '1px solid #ccc';
    outputBox.style.padding = '12px';
    outputBox.style.zIndex = '9999';
    outputBox.style.maxWidth = '420px';
    outputBox.style.maxHeight = '50vh';
    outputBox.style.overflow = 'auto';
    outputBox.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    outputBox.style.fontSize = '13px';
    outputBox.style.lineHeight = '1.4';

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    title.textContent = 'Thread summary';

    const content = document.createElement('div');
    content.textContent = summaryText;

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.marginTop = '10px';
    close.style.background = '#f1f3f4';
    close.style.border = '1px solid #dadce0';
    close.style.padding = '6px 10px';
    close.style.borderRadius = '4px';
    close.style.cursor = 'pointer';
    close.addEventListener('click', () => outputBox.remove());

    outputBox.appendChild(title);
    outputBox.appendChild(content);
    outputBox.appendChild(close);

    document.body.appendChild(outputBox);
  }

  // Handler for summarize action
  async function handleSummarizeThread() {
    try {
      showStatusMessage("Collecting thread content...", "info");

      const text = extractThreadText();
      if (!text) {
        showStatusMessage("No email content found in this thread.", "error");
        return;
      }

      // Step 1: Collect selected summary style (Short, BulletPoints, Detailed)
      const selectedStyleButton = document.querySelector("#myga-summary-style-selector .myga-chip--selected");
      const style = selectedStyleButton ? selectedStyleButton.dataset.style : "Short";

      showStatusMessage("Summarizing thread...", "info");

      // Step 2: Send to background with style
      const summary = await callSummarizeAPI(text, style);

      //Step 3: Display Summary
      showSummaryOutput(summary);
      showStatusMessage("✓ Summary generated successfully!", "success");

    } catch (error) {
      console.error("Summarize thread error:", error);
      let errorMessage = error.message;

      if (error.message.includes("Failed to connect")) {
        errorMessage = "Backend server is not running. Please start the backend at http://localhost:8080";
      }

      showStatusMessage(`Error: ${errorMessage}`, "error");
    }
  }

  // Gmail is an SPA; run on initial load and when the URL changes
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      initWhenGmailReady();
    }
  });

  observer.observe(document, { subtree: true, childList: true });
  window.addEventListener("load", initWhenGmailReady);
  initWhenGmailReady();
})();
