package com.gmail.agent.controller;

import com.gmail.agent.entity.Gmail;
import com.gmail.agent.service.GmailService;
import org.springframework.ai.retry.TransientAiException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin(origins = "chrome-extension://bfpckohipmchjpolgddkbojmbgcckhld")
@RequestMapping("/api/v1/agent")
public class GmailController {
    private final GmailService gmailService;

    public GmailController(GmailService gmailService) {
        this.gmailService = gmailService;
    }

    @PostMapping("/reply")
    public ResponseEntity<String> generateReply(@RequestBody Gmail gmail, @RequestParam String tone) {
        try {
            String reply = gmailService.generateReply(gmail, tone);
            return new ResponseEntity<>(reply, HttpStatus.OK);
        } catch (IllegalArgumentException e) {
            return new ResponseEntity<>(e.getMessage(), HttpStatus.BAD_REQUEST);
        } catch (TransientAiException e) {
            return new ResponseEntity<>(e.getMessage(), HttpStatus.TOO_MANY_REQUESTS);
        } catch (Exception e) {
            return new ResponseEntity<>(e.getMessage(), HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @PostMapping("/summary")
    public ResponseEntity<String> generateSummary(@RequestBody Gmail gmail,
                                                  @RequestParam(defaultValue = "short") String style) {
        try {
            String summary = gmailService.generateSummary(gmail, style);
            return new ResponseEntity<>(summary, HttpStatus.OK);
        } catch (IllegalArgumentException e) {
            return new ResponseEntity<>(e.getMessage(), HttpStatus.BAD_REQUEST);
        } catch (TransientAiException e) {
            return new ResponseEntity<>(e.getMessage(), HttpStatus.TOO_MANY_REQUESTS);
        } catch (Exception e) {
            return new ResponseEntity<>(e.getMessage(), HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

}