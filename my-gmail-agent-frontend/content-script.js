// My Gmail Agent - Content Script
// Functionality: Generates AI-powered email replies by extracting email content from DOM and calling backend API.

(function () {
  const SIDEBAR_ID = "myga-sidebar";
  const FAB_ID = "myga-fab";
  
  // Valid tones for reply generation
  const VALID_TONES = ["Formal", "Courteous", "Concise", "Casual", "Empathetic", "Rigid"];

  // Detect current Gmail context
  function detectContext() {
    const url = window.location.href;
    
    // Check if we're viewing a thread (email is open)
    // Gmail thread URL patterns: 
    // - #inbox/[threadId]
    // - #starred/[threadId]
    // - #sent/[threadId]
    // - #snoozed/[threadId]
    // - #category/label/[threadId]
    // - #imp/[threadId]
    // - #scheduled/[threadId]
    // - #all/[threadId]
    // - #spam/[threadId]
    // - #trash/[threadId]
    // Thread IDs are typically 30+ alphanumeric characters
    
    const threadMatch = url.match(/#[^/]+\/[A-Za-z0-9]{20,}$|#[^/]+\/[^/]+\/[A-Za-z0-9]{20,}$/);
    if (threadMatch && !url.includes("#drafts/")) {
      return "thread";
    }
    
    // Check if compose window is open
    if (url.includes("?compose=")) {
      return "inbox";
    }
    
    // Otherwise, we're in inbox/list view (including drafts)
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
      const subjectElement = document.querySelector('.hP');
      if (subjectElement) {
        subject = subjectElement.textContent.trim();
      } else {
        // Fallback: look for subject in heading
        const headingElement = emailBody.querySelector('h2');
        subject = headingElement ? headingElement.textContent.trim() : "";
      }

      // FROM (sender)
      let fromAddress = "";
      const fromEl = document.querySelector('.gD');
      if (fromEl) {
        const hovercard = fromEl.getAttribute('data-hovercard-id');
        if (hovercard && hovercard.includes('#')) {
          fromAddress = hovercard.split('#')[1];
        } else {
          fromAddress = fromEl.textContent.trim();
        }
      }

      // TO recipients
      let toAddress = [];
      const toEls = document.querySelectorAll('.g2');
      toEls.forEach(el => {
        const hovercard = el.getAttribute('data-hovercard-id');
        if (hovercard && hovercard.includes('#')) {
          toAddress.push(hovercard.split('#')[1]);
        } else {
          toAddress.push(el.textContent.trim());
        }
      });

      // fallback: search any mailto links if no from
      if (!fromAddress) {
        const mailto = emailBody.querySelector('a[href^="mailto:"]');
        if (mailto) {
          fromAddress = mailto.href.replace('mailto:', '').trim();
        }
      }

      console.log("FROM:", fromAddress);
      console.log("TO:", toAddress);

      // Find email content - Gmail stores message content in .a3s containers
      let content = "";
      const contentEls = document.querySelectorAll('.a3s');
      if (contentEls.length > 0) {
        // Get the most recent message content (last in thread)
        content = contentEls[contentEls.length - 1].textContent.trim();
      } else {
        // Fallback: extract all visible text from main area
        content = emailBody.innerText.trim();
      }

      // Clean up content
      subject = subject.trim();
      content = content.trim().substring(0, 2000); // Limit to 2000 chars to avoid token limits
      fromAddress = fromAddress.trim();
      toAddress = toAddress.join(", ").trim();

      if (!subject || !content) {
        console.warn("Subject or content is empty. Subject:", subject, "Content length:", content.length);
        return null;
      }

      console.log("Extracted email addresses - From:", fromAddress, "To:", toAddress);

      return { subject, content, fromAddress, toAddress };
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

    const url = window.location.href;
    
    // Skip initialization on settings, labels management, subscriptions, and other management pages
    if (url.includes("#settings") || url.includes("#help") || url.includes("#sub")) {
      // Remove UI if it exists on these pages
      const oldSidebar = document.getElementById(SIDEBAR_ID);
      const oldFab = document.getElementById(FAB_ID);
      if (oldSidebar) oldSidebar.remove();
      if (oldFab) oldFab.remove();
      return;
    }

    // Remove old UI if exists (for context switching)
    const oldSidebar = document.getElementById(SIDEBAR_ID);
    const oldFab = document.getElementById(FAB_ID);
    if (oldSidebar) oldSidebar.remove();
    if (oldFab) oldFab.remove();

    createFloatingButton();
    createSidebar();
    handleSearchLanding();
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

          <div id="myga-status-message" class="myga-status-message" style="display: none;"></div>
          <div class="myga-scrollable-content">
          <section class="myga-section">
            <h2 class="myga-section-title">Smart search</h2>
            <p class="myga-section-desc">
              Describe what you're looking for. Our AI converts it to Gmail search.
            </p>

            <!-- Search input -->
            <div class="myga-field-group">
              <label class="myga-label" for="myga-search-input">Search query</label>
              <div class="myga-search-input-wrapper">
                <input 
                  type="text" 
                  id="myga-search-input" 
                  class="myga-search-input" 
                  placeholder="e.g., emails from John about the project..."
                  aria-label="Search emails"
                />
                <button class="myga-search-clear-btn" type="button" id="myga-search-clear" aria-label="Clear search">✕</button>
              </div>
            </div>

            <!-- Search button -->
            <button class="myga-primary-button" type="button" id="myga-search-button">
              🔍 Search
            </button>
          </section>

          <section class="myga-section">
            <h2 class="myga-section-title">Analyze priority</h2>
            <p class="myga-section-desc">
              Determine if an email requires action and what to do.
            </p>
            <div class="myga-field-group">
              <label class="myga-label">Priority analysis mode</label>
              <div class="myga-chip-row" id="myga-priority-mode-selector">
                <button class="myga-chip myga-chip--selected" type="button" data-mode="single">Single Mail</button>
                <button class="myga-chip" type="button" data-mode="dashboard">Smart Dashboard</button>
              </div>
            </div>
            <button class="myga-primary-button" type="button" id="myga-analyze-priority-button">
              Analyze priority
            </button>
          </section>
          </div>
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
        const toneButtons = sidebar.querySelectorAll("#myga-tone-selector .myga-chip");
        toneButtons.forEach(btn => btn.classList.remove("myga-chip--selected"));
        target.classList.add("myga-chip--selected");
      }

      //Handle summary style selection
      if (target.classList.contains("myga-chip") && target.dataset.style) {
        const styleButtons = sidebar.querySelectorAll("#myga-summary-style-selector .myga-chip");
        styleButtons.forEach((btn) => btn.classList.remove("myga-chip--selected"));
        target.classList.add("myga-chip--selected");
      }

      // Handle priority mode selection
      if (target.classList.contains("myga-chip") && target.dataset.mode) {
        const modeButtons = sidebar.querySelectorAll("#myga-priority-mode-selector .myga-chip");
        modeButtons.forEach((btn) => btn.classList.remove("myga-chip--selected"));
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

      // Handle analyze priority button
      if (target.id === "myga-analyze-priority-button") {
        handleAnalyzePriority();
      }

      // Handle smart search button
      if (target.id === "myga-search-button") {
        handleSmartSearch();
      }

      // Handle search clear button
      if (target.id === "myga-search-clear") {
        const searchInput = document.getElementById("myga-search-input");
        if (searchInput) {
          searchInput.value = "";
          searchInput.focus();
          target.style.display = "none";
        }
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
    try {
      // Gmail's main content area often contains the entire thread
      const emailBody = document.querySelector('[role="main"]');
      if (!emailBody) {
        console.warn("extractThreadText: main content area not found");
        return "";
      }

      // First attempt: grab each message body container (.a3s)
      let bodies = Array.from(emailBody.querySelectorAll('.a3s'))
        .map(div => (div.innerText || div.textContent || "").trim())
        .filter(Boolean);

      let fullText = bodies.join("\n\n").trim();

      // Fallback: if the .a3s selection is empty or seems much shorter than
      // the entire main area, use the larger blob. This catches hidden/
      // quoted replies and long threads that Gmail collapses.
      const fallback = (emailBody.innerText || emailBody.textContent || "").trim();
      if (!fullText || fallback.length > fullText.length * 1.2) {
        fullText = fallback;
      }

      return fullText;
    } catch (err) {
      console.error("Error in extractThreadText:", err);
      return "";
    }
  }

  // Call background to summarize (avoids CORS)
  async function callSummarizeAPI(threadText, style, subject, fromAddress, toAddress) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          reject(new Error("Chrome runtime is not available. Extension may not be properly initialized."));
          return;
        }

        // include selected style and subject in the message so background can pass them to the backend
        chrome.runtime.sendMessage(
          { action: "summarizeEmail", emailContent: threadText, style: style, subject: subject, fromAddress: fromAddress, toAddress: toAddress },
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
    outputBox.style.zIndex = '2147483642';
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
      console.log("Extracted thread text length:", text.length, "chars");
      if (!text) {
        showStatusMessage("No email content found in this thread.", "error");
        return;
      }

      // Step 1: Collect selected summary style (Short, BulletPoints, Detailed)
      const selectedStyleButton = document.querySelector("#myga-summary-style-selector .myga-chip--selected");
      const style = selectedStyleButton ? selectedStyleButton.dataset.style : "Short";

      showStatusMessage("Summarizing thread...", "info");

      // Step 2: Determine subject and send to background with style
      const emailMeta = extractEmailContent();
      const subject = (emailMeta && emailMeta.subject) ? emailMeta.subject : "Thread summary";
      const fromAddress = (emailMeta && emailMeta.fromAddress) ? emailMeta.fromAddress : "";
      const toAddress = (emailMeta && emailMeta.toAddress) ? emailMeta.toAddress : "";

      const summary = await callSummarizeAPI(text, style, subject, fromAddress, toAddress);

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

  // Call background to analyze priority
  async function callAnalyzePriorityAPI(emailData) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: "analyzePriority",
        emailData: emailData
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  // Call background to get priority dashboard
  async function callPriorityDashboardAPI() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: "getPriorityDashboard"
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response.success) {
          resolve(response.dashboard);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  
  // Render priority analysis in a floating box
  function showPriorityOutput(result) {
    const existingBox = document.getElementById('priority-output-box');
    if (existingBox) existingBox.remove();

    const outputBox = document.createElement('div');
    outputBox.id = 'priority-output-box';
    outputBox.className = 'myga-summary-box';

    outputBox.style.position = 'fixed';
    outputBox.style.bottom = '20px';
    outputBox.style.right = '20px';
    outputBox.style.background = '#fff';
    outputBox.style.border = '1px solid #ccc';
    outputBox.style.padding = '12px';
    outputBox.style.zIndex = '2147483642';
    outputBox.style.maxWidth = '420px';
    outputBox.style.maxHeight = '50vh';
    outputBox.style.overflow = 'auto';
    outputBox.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    outputBox.style.fontSize = '13px';
    outputBox.style.lineHeight = '1.4';

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    title.textContent = 'Priority Analysis';

    const content = document.createElement('div');
    const reasonHTML = result.actionDecision === 'ACTION_REQUIRED' ? '' : `<br><strong>Reason:</strong> ${result.reason}`;
    content.innerHTML = `
      <strong>Action:</strong> ${result.actionDecision}<br>
      <strong>Action Item:</strong> ${result.actionItem}<br>
      <strong>Deadline:</strong> ${result.deadline}${reasonHTML}
    `;

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

  // Display smart priority dashboard
  function showPriorityDashboard(dashboard) {
    const existingBox = document.getElementById('priority-dashboard-box');
    if (existingBox) existingBox.remove();

    const outputBox = document.createElement('div');
    outputBox.id = 'priority-dashboard-box';
    outputBox.className = 'myga-summary-box';

    outputBox.style.position = 'fixed';
    outputBox.style.bottom = '20px';
    outputBox.style.right = '20px';
    outputBox.style.background = '#fff';
    outputBox.style.border = '1px solid #ccc';
    outputBox.style.padding = '12px';
    outputBox.style.zIndex = '2147483642';
    outputBox.style.maxWidth = '500px';
    outputBox.style.maxHeight = '70vh';
    outputBox.style.overflow = 'auto';
    outputBox.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    outputBox.style.fontSize = '13px';
    outputBox.style.lineHeight = '1.5';

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';
    title.style.fontSize = '14px';
    title.textContent = `📊 Smart Priority Dashboard`;

    const summary = document.createElement('div');
    summary.style.marginBottom = '12px';
    summary.style.padding = '8px';
    summary.style.background = '#f0f4f8';
    summary.style.borderRadius = '4px';
    summary.innerHTML = `<strong>High Priority Emails Found:</strong> ${dashboard.totalHighPriorityCount}`;

    const content = document.createElement('div');
    content.style.maxHeight = '55vh';
    content.style.overflow = 'auto';

    if (dashboard.highPriorityEmails && dashboard.highPriorityEmails.length > 0) {
      const emailList = document.createElement('div');
      
      dashboard.highPriorityEmails.forEach((email, index) => {
        const emailItem = document.createElement('div');
        emailItem.style.marginBottom = '10px';
        emailItem.style.padding = '8px';
        emailItem.style.border = '1px solid #e0e0e0';
        emailItem.style.borderRadius = '4px';
        emailItem.style.cursor = 'pointer';
        emailItem.style.transition = 'background-color 0.2s';
        
        emailItem.addEventListener('mouseover', () => {
          emailItem.style.backgroundColor = '#f5f5f5';
        });
        emailItem.addEventListener('mouseout', () => {
          emailItem.style.backgroundColor = 'transparent';
        });

        const reasonSection = email.actionDecision === 'ACTION_REQUIRED' ? '' : `
          <div style="font-size: 12px; color: #555; padding-top: 4px; border-top: 1px solid #eee;">
            <strong>Reason:</strong> ${email.reason}
          </div>`;
        emailItem.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 4px; color: #c5221f;">⚠️ ${email.subject}</div>
          <div style="font-size: 12px; color: #666; margin-bottom: 4px;">From: ${email.fromAddress}</div>
          <div style="font-size: 12px; margin-bottom: 4px;">
            <strong>Action:</strong> ${email.actionDecision}<br>
            <strong>Item:</strong> ${email.actionItem}<br>
            <strong>Deadline:</strong> ${email.deadline}
          </div>${reasonSection}
        `;

        emailList.appendChild(emailItem);
      });

      content.appendChild(emailList);
    } else {
      const noEmails = document.createElement('div');
      noEmails.style.padding = '20px';
      noEmails.style.textAlign = 'center';
      noEmails.style.color = '#666';
      noEmails.innerHTML = '<p>✓ No high-priority emails at this time. Great job!</p>';
      content.appendChild(noEmails);
    }

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.marginTop = '10px';
    close.style.background = '#f1f3f4';
    close.style.border = '1px solid #dadce0';
    close.style.padding = '6px 10px';
    close.style.borderRadius = '4px';
    close.style.cursor = 'pointer';
    close.style.width = '100%';
    close.addEventListener('click', () => outputBox.remove());

    outputBox.appendChild(title);
    outputBox.appendChild(summary);
    outputBox.appendChild(content);
    outputBox.appendChild(close);

    document.body.appendChild(outputBox);
  }

  // Handler for analyze priority action
  async function handleAnalyzePriority() {
    try {
      // Get selected priority mode
      const selectedModeButton = document.querySelector("#myga-priority-mode-selector .myga-chip--selected");
      const mode = selectedModeButton ? selectedModeButton.dataset.mode : "single";

      if (mode === "dashboard") {
        handleSmartPriorityDashboard();
      } else {
        handleSingleMailPriority();
      }
    } catch (error) {
      console.error("Handle priority mode error:", error);
      showStatusMessage("Error selecting priority mode", "error");
    }
  }

  // Single mail priority analysis with validation
  async function handleSingleMailPriority() {
    try {
      showStatusMessage("Analyzing single email priority...", "info");

      let emailData;
      const context = detectContext();

      if (context === "thread") {
        emailData = extractEmailContent();
      } else {
        emailData = extractEmailFromInboxPreview();
      }

      if (!emailData || !emailData.subject || !emailData.content) {
        showStatusMessage("Unable to extract email content. Please open the email thread or select a single email row in the inbox.", "error");
        return;
      }

      const result = await callAnalyzePriorityAPI(emailData);

      showPriorityOutput(result);
      showStatusMessage("✓ Priority analyzed!", "success");

    } catch (error) {
      console.error("Single mail priority error:", error);
      
      // Handle specific error for multiple selections
      if (error.message === "MULTIPLE_EMAILS_SELECTED") {
        showStatusMessage("❌ You have not selected one mail. Please select exactly ONE email for single mail analysis.", "error");
        return;
      }

      let errorMessage = error.message;

      if (error.message.includes("Failed to connect")) {
        errorMessage = "Backend server is not running. Please start the backend at http://localhost:8080";
      }

      showStatusMessage(`Error: ${errorMessage}`, "error");
    }
  }

  // Smart priority dashboard mode
  // Extract all selected emails from inbox (for dashboard mode)
  function extractAllSelectedEmailsFromInbox() {
    const checkedBoxes = document.querySelectorAll('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]');
    const emails = [];
    checkedBoxes.forEach((checked) => {
      let row = checked.closest('tr');
      if (!row) row = checked.closest('.zA');
      if (!row) row = checked.closest('[role="row"]');
      if (!row) row = checked.closest('.zE');
      if (!row) return;

      // Subject
      let subject = "";
      const subjectSelectors = ['.bog', '.y6', 'span.zF', '.zF'];
      for (const sel of subjectSelectors) {
        const el = row.querySelector(sel);
        if (el) {
          subject = (el.innerText || el.textContent || "").trim();
          if (subject && subject.length > 0) break;
        }
      }

      // Sender
      let fromAddress = "";
      const senderSelectors = ['.yX span', '.yW span', '.yP', '.gD'];
      for (const sel of senderSelectors) {
        const el = row.querySelector(sel);
        if (el) {
          fromAddress = (el.innerText || el.textContent || "").trim();
          if (fromAddress && fromAddress.length > 0) break;
        }
      }

      // Content/preview
      let content = "";
      const contentSelectors = ['.y2', '.bqe', '[data-snippet]'];
      for (const sel of contentSelectors) {
        const el = row.querySelector(sel);
        if (el) {
          content = (el.innerText || el.textContent || "").trim();
          if (content && content.length > 0) break;
        }
      }
      if (!content) content = (row.innerText || row.textContent || "").trim();
      if (!subject) subject = "Email";
      if (!content) content = "No content available";

      emails.push({
        subject: subject.substring(0, 200),
        content: content.substring(0, 2000),
        fromAddress: fromAddress.substring(0, 100),
        toAddress: ""
      });
    });
    return emails;
  }

  // Updated Smart priority dashboard mode
  async function handleSmartPriorityDashboard() {
    try {
      showStatusMessage("Analyzing selected emails for high-priority...", "info");

      // Extract all selected emails
      const selectedEmails = extractAllSelectedEmailsFromInbox();
      if (selectedEmails.length > 5) {
        showStatusMessage("Maximum 5 emails can be selected for priority analysis on the free tier.", "error");
        return;
      }
      if (!selectedEmails || selectedEmails.length === 0) {
        showStatusMessage("❌ Please select one or more emails in the inbox to analyze.", "error");
        return;
      }

      // Send selected emails to backend for dashboard analysis
      const dashboard = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: "getPriorityDashboard",
          emails: selectedEmails
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response.success) {
            resolve(response.dashboard);
          } else {
            reject(new Error(response.error));
          }
        });
      });

      showPriorityDashboard(dashboard);
      showStatusMessage("✓ Smart priority dashboard loaded!", "success");

    } catch (error) {
      console.error("Smart priority dashboard error:", error);
      let errorMessage = error.message;

      if (error.message.includes("Failed to connect")) {
        errorMessage = "Backend server is not running. Please start the backend at http://localhost:8080";
      }

      showStatusMessage('Error: ' + errorMessage, 'error');
    }
  }

  // Extract email content from inbox preview/selected email row
  function extractEmailFromInboxPreview() {
    try {
      console.log("=== Starting inbox email extraction ===");
      
      // Find all checked checkboxes
      const allChecked = document.querySelectorAll('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]');
      console.log("Total checked checkboxes:", allChecked.length);
      
      if (allChecked.length === 0) {
        console.warn("No checked checkbox found");
        return null;
      }

      if (allChecked.length > 1) {
        console.warn("Multiple emails checked. Please select only ONE email. Found:", allChecked.length);
        throw new Error("MULTIPLE_EMAILS_SELECTED");
      }

      const checked = allChecked[0];
      console.log("✓ Found single checked email");

      // Find parent row using multiple selectors
      let row = checked.closest('tr');
      if (!row) row = checked.closest('.zA');
      if (!row) row = checked.closest('[role="row"]');
      if (!row) row = checked.closest('.zE');
      if (!row) {
        console.warn("Could not find parent row for checked email");
        return null;
      }

      console.log("✓ Found parent row, class:", row.className);

      // Try multiple selectors for subject
      let subject = "";
      const subjectSelectors = ['.bog', '.y6', 'span.zF', '.zF'];
      for (const sel of subjectSelectors) {
        const el = row.querySelector(sel);
        if (el) {
          subject = (el.innerText || el.textContent || "").trim();
          if (subject && subject.length > 0) {
            console.log('✓ Found subject via ' + sel);
            break;
          }
        }
      }

      // Try multiple selectors for sender
      let fromAddress = "";
      const senderSelectors = ['.yX span', '.yW span', '.yP', '.gD'];
      for (const sel of senderSelectors) {
        const el = row.querySelector(sel);
        if (el) {
          fromAddress = (el.innerText || el.textContent || "").trim();
          if (fromAddress && fromAddress.length > 0) {
            console.log('✓ Found sender via ' + sel);
            break;
          }
        }
      }

      // Try multiple selectors for content/preview
      let content = "";
      const contentSelectors = ['.y2', '.bqe', '[data-snippet]'];
      for (const sel of contentSelectors) {
        const el = row.querySelector(sel);
        if (el) {
          content = (el.innerText || el.textContent || "").trim();
          if (content && content.length > 0) {
            console.log('✓ Found content via ' + sel);
            break;
          }
        }
      }

      // Fallback: use all row text as content if nothing found
      if (!content) {
        content = (row.innerText || row.textContent || "").trim();
        if (content) {
          console.log("✓ Using fallback row text as content");
        }
      }

      // Ensure we have at least some content
      if (!subject) subject = "Email";
      if (!content) content = "No content available";

      console.log("Extraction complete:", {
        subject: subject.substring(0, 40),
        hasContent: content.length > 0,
        contentLength: content.length,
        sender: fromAddress.substring(0, 30)
      });

      return {
        subject: subject.substring(0, 200),
        content: content.substring(0, 2000),
        fromAddress: fromAddress.substring(0, 100),
        toAddress: ""
      };
    } catch (error) {
      console.error("Error extracting email from inbox preview:", error);
      // Re-throw specific validation errors
      if (error.message === "MULTIPLE_EMAILS_SELECTED") {
        throw error;
      }
      return null;
    }
  }

  // ===== Smart Search Feature =====

  // Handler for smart search
  async function handleSmartSearch() {
    try {
      const searchInput = document.getElementById("myga-search-input");
      const query = searchInput ? searchInput.value.trim() : "";

      if (!query) {
        showStatusMessage("Please enter a search query", "error");
        return;
      }

      const searchButton = document.getElementById("myga-search-button");
      searchButton.disabled = true;
      searchButton.textContent = "Searching...";
      showStatusMessage("Converting to Gmail search...", "info");

      console.log("Natural language query:", query);

      // Ask background to convert the natural language query to Gmail syntax
      const converted = await callConvertQueryAPI(query);

      // Use converted query (fallback to original if missing)
      const gmailQuery = converted.convertedQuery || query;

      // Show success message before navigation
      showStatusMessage("✓ Search executed! Navigating to Gmail...", "success");

      // Persist converted + original queries across navigation so we can show results after Gmail loads
      try {
        sessionStorage.setItem('myga_converted_query', gmailQuery);
        sessionStorage.setItem('myga_original_query', query);
        sessionStorage.setItem('myga_converted_at', new Date().toISOString());
      } catch (e) {
        // sessionStorage may be unavailable in some contexts; ignore silently
        console.warn('Unable to persist converted query in sessionStorage', e);
      }

      // Small delay to show the success message before navigating away
      setTimeout(() => {
        performGmailSearch(gmailQuery);
      }, 500);

      searchButton.disabled = false;
      searchButton.textContent = "🔍 Search";
    } catch (error) {
      console.error("Smart search error:", error);
      showStatusMessage('Error: ' + error.message, 'error');
      const searchButton = document.getElementById("myga-search-button");
      searchButton.disabled = false;
      searchButton.textContent = "🔍 Search";
    }
  }

  // Call background to convert natural language query to Gmail syntax
  function callConvertQueryAPI(query) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          reject(new Error("Chrome runtime is not available. Extension may not be properly initialized."));
          return;
        }

        chrome.runtime.sendMessage({ action: "convertQuery", query: query }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error("No response from background script."));
            return;
          }
          if (response.success) {
            resolve(response);
          } else {
            reject(new Error(response.error || "Unknown error from background script."));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Perform search in Gmail inbox
  function performGmailSearch(query) {
    // Gmail search syntax: Use the search box
    // We'll navigate to Gmail's search page with the query
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = 'https://mail.google.com/mail/u/0/#search/' + encodedQuery;
    
    // Open search in current window or new tab
    window.location.href = searchUrl;
  }


  // Handle landing on Gmail search page after navigation from smart search
  async function handleSearchLanding() {
    try {
      // Only run on Gmail search pages
      if (!location.hash.startsWith('#search/')) return;

      const converted = sessionStorage.getItem('myga_converted_query');
      const original = sessionStorage.getItem('myga_original_query');
      if (!converted) return;

      showStatusMessage('✓ Search applied! Query: ' + original, 'success');

      // Clean up stored queries
      try {
        sessionStorage.removeItem('myga_converted_query');
        sessionStorage.removeItem('myga_original_query');
        sessionStorage.removeItem('myga_converted_at');
      } catch (e) {}
    } catch (err) {
      console.error('handleSearchLanding error:', err);
    }
  }

  // Add input event listener for search input (for showing/hiding clear button)
  document.addEventListener("input", (event) => {
    if (event.target && event.target.id === "myga-search-input") {
      const searchInput = event.target;
      const clearBtn = document.getElementById("myga-search-clear");
      if (clearBtn) {
        clearBtn.style.display = searchInput.value.length > 0 ? "flex" : "none";
      }
    }
  });

  // Add keydown listener for Enter key in search input
  document.addEventListener("keydown", (event) => {
    if (event.target && event.target.id === "myga-search-input" && event.key === "Enter") {
      event.preventDefault();
      const searchButton = document.getElementById("myga-search-button");
      if (searchButton) {
        searchButton.click();
      }
    }
  });


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