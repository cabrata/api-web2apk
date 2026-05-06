package com.webapk.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.button.MaterialButton;

public class MainActivity extends Activity {

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private LinearLayout navBar;
    private FrameLayout splashScreen;
    private LinearLayout errorView;
    private ImageButton btnBack, btnForward, btnRefresh, btnShare, btnMenu;
    private MaterialButton btnRetry;

    private ValueCallback<Uri[]> fileUploadCallback;
    private static final int FILE_CHOOSER_REQUEST = 1;
    private boolean isPageLoaded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (AppConfig.FULLSCREEN) {
            requestWindowFeature(Window.FEATURE_NO_TITLE);
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
            );
        }

        setContentView(R.layout.activity_main);

        initViews();
        setupWebView();
        setupNavBar();
        setupSwipeRefresh();
        applyConfig();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            loadUrl(AppConfig.TARGET_URL);
        }
    }

    private void initViews() {
        webView = findViewById(R.id.webview);
        progressBar = findViewById(R.id.progressbar);
        swipeRefresh = findViewById(R.id.swipe_refresh);
        navBar = findViewById(R.id.nav_bar);
        splashScreen = findViewById(R.id.splash_screen);
        errorView = findViewById(R.id.error_view);
        btnBack = findViewById(R.id.btn_back);
        btnForward = findViewById(R.id.btn_forward);
        btnRefresh = findViewById(R.id.btn_refresh);
        btnShare = findViewById(R.id.btn_share);
        btnMenu = findViewById(R.id.btn_menu);
        btnRetry = findViewById(R.id.btn_retry);
    }

    private void applyConfig() {
        // Navigation bar visibility
        navBar.setVisibility(AppConfig.SHOW_NAV_BAR ? View.VISIBLE : View.GONE);

        // Pull to refresh
        swipeRefresh.setEnabled(AppConfig.ENABLE_PULL_TO_REFRESH);

        // Splash screen
        if (AppConfig.ENABLE_SPLASH) {
            splashScreen.setVisibility(View.VISIBLE);
            // Safety timeout: auto-hide splash after 5 seconds even if page doesn't finish
            splashScreen.postDelayed(() -> {
                if (splashScreen.getVisibility() == View.VISIBLE) {
                    hideSplashScreen();
                }
            }, 5000);
        }
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(true);

        // Remove WebView identifier from user agent
        String ua = settings.getUserAgentString();
        settings.setUserAgentString(ua.replace("; wv", ""));

        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                progressBar.setVisibility(View.VISIBLE);
                errorView.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                updateNavButtons();

                // Hide splash screen with fade animation
                if (!isPageLoaded && AppConfig.ENABLE_SPLASH) {
                    isPageLoaded = true;
                    hideSplashScreen();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    swipeRefresh.setRefreshing(false);
                    progressBar.setVisibility(View.GONE);
                    showErrorView();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // Open external intents in external apps
                if (url.startsWith("tel:") || url.startsWith("mailto:") ||
                    url.startsWith("intent:") || url.startsWith("whatsapp:") ||
                    url.startsWith("tg:") || url.startsWith("viber:")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
            }

            @Override
            public boolean onShowFileChooser(WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });
    }

    private void setupNavBar() {
        btnBack.setOnClickListener(v -> {
            if (webView.canGoBack()) {
                webView.goBack();
            }
        });

        btnForward.setOnClickListener(v -> {
            if (webView.canGoForward()) {
                webView.goForward();
            }
        });

        btnRefresh.setOnClickListener(v -> webView.reload());

        btnShare.setOnClickListener(v -> shareUrl());

        btnMenu.setOnClickListener(v -> showPopupMenu(v));

        btnRetry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            webView.reload();
        });
    }

    private void setupSwipeRefresh() {
        swipeRefresh.setColorSchemeResources(R.color.colorPrimary, R.color.colorAccent);
        swipeRefresh.setOnRefreshListener(() -> webView.reload());
    }

    private void updateNavButtons() {
        btnBack.setAlpha(webView.canGoBack() ? 1.0f : 0.35f);
        btnForward.setAlpha(webView.canGoForward() ? 1.0f : 0.35f);
    }

    private void hideSplashScreen() {
        if (splashScreen.getVisibility() != View.VISIBLE) return;

        AlphaAnimation fadeOut = new AlphaAnimation(1.0f, 0.0f);
        fadeOut.setDuration(400);
        fadeOut.setAnimationListener(new Animation.AnimationListener() {
            @Override
            public void onAnimationStart(Animation animation) {}

            @Override
            public void onAnimationEnd(Animation animation) {
                splashScreen.clearAnimation();
                splashScreen.setVisibility(View.GONE);
            }

            @Override
            public void onAnimationRepeat(Animation animation) {}
        });
        splashScreen.startAnimation(fadeOut);
    }

    private void showErrorView() {
        if (!isNetworkAvailable()) {
            errorView.setVisibility(View.VISIBLE);
        }
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
            return activeNetwork != null && activeNetwork.isConnected();
        }
        return false;
    }

    private void loadUrl(String url) {
        if (isNetworkAvailable()) {
            webView.loadUrl(url);
        } else {
            showErrorView();
            if (AppConfig.ENABLE_SPLASH) {
                splashScreen.setVisibility(View.GONE);
            }
        }
    }

    private void shareUrl() {
        String url = webView.getUrl();
        if (url != null) {
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("text/plain");
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, webView.getTitle());
            shareIntent.putExtra(Intent.EXTRA_TEXT, url);
            startActivity(Intent.createChooser(shareIntent, "Share via"));
        }
    }

    private void openInChrome() {
        String url = webView.getUrl();
        if (url != null) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                // Try Chrome first
                intent.setPackage("com.android.chrome");
                startActivity(intent);
            } catch (Exception e) {
                // Fallback to any browser
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                } catch (Exception ex) {
                    Toast.makeText(this, "No browser found", Toast.LENGTH_SHORT).show();
                }
            }
        }
    }

    private void copyLink() {
        String url = webView.getUrl();
        if (url != null) {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("URL", url);
            clipboard.setPrimaryClip(clip);
            Toast.makeText(this, R.string.link_copied, Toast.LENGTH_SHORT).show();
        }
    }

    private void showPopupMenu(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor);
        popup.getMenuInflater().inflate(R.menu.popup_menu, popup.getMenu());

        popup.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.menu_open_chrome) {
                openInChrome();
                return true;
            } else if (id == R.id.menu_share) {
                shareUrl();
                return true;
            } else if (id == R.id.menu_refresh) {
                webView.reload();
                return true;
            } else if (id == R.id.menu_copy_link) {
                copyLink();
                return true;
            } else if (id == R.id.menu_exit) {
                finish();
                return true;
            }
            return false;
        });

        popup.show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    String dataString = data.getDataString();
                    if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
