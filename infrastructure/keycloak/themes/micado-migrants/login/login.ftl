<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=false; section>
  <#if section = "header">
    <span class="micado-hidden-header">${msg("loginAccountTitle")}</span>
  <#elseif section = "form">
    <div class="micado-page">
      <div class="micado-topbar">
        <div class="micado-topbar__brand">
          <img
            class="micado-topbar__logo"
            src="${url.resourcesPath}/img/micado-logo.png"
            alt="Micado"
          />
          <span class="micado-topbar__title">IDENTITY SERVER</span>
        </div>
      </div>

      <div class="micado-login-shell">
        <div class="micado-card">
          <div class="micado-card__header">SIGN IN</div>

          <div class="micado-card__body">
            <form id="kc-form-login" class="micado-form" action="${url.loginAction}" method="post">

              <div class="micado-field">
                <label for="username" class="micado-label">
                  <#if !realm.loginWithEmailAllowed>${msg("username")}
                  <#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}
                  <#else>${msg("email")}</#if>
                </label>

                <input
                  tabindex="1"
                  id="username"
                  class="micado-input"
                  name="username"
                  value="${(login.username!'')}"
                  type="text"
                  autofocus
                  autocomplete="username"
                  aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                />

                <#if messagesPerField.existsError('username','password')>
                  <span class="micado-error" aria-live="polite">
                    ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                  </span>
                </#if>
              </div>

              <div class="micado-field">
                <label for="password" class="micado-label">${msg("password")}</label>

                <div class="micado-password-wrap">
                  <input
                    tabindex="2"
                    id="password"
                    class="micado-input micado-input--password"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                  />
                  <button
                    class="micado-password-toggle"
                    type="button"
                    aria-label="Toggle password visibility"
                    onclick="(function(btn){const i=document.getElementById('password');const shown=i.type==='text';i.type=shown?'password':'text';btn.classList.toggle('is-visible',!shown);btn.setAttribute('aria-pressed', String(!shown));})(this)"
                    aria-pressed="false"
                  >
                    <span aria-hidden="true">&#128065;</span>
                  </button>
                </div>
              </div>

              <#if realm.rememberMe && !usernameEditDisabled??>
                <div class="micado-checkbox-row">
                  <label class="micado-checkbox" for="rememberMe">
                    <input
                      tabindex="3"
                      id="rememberMe"
                      name="rememberMe"
                      type="checkbox"
                      <#if login.rememberMe??>checked</#if>
                    />
                    <span>Remember me on this computer</span>
                  </label>
                </div>
              </#if>

              <div class="micado-copy">
                <p>
                  After a successful sign in, we use a cookie in your browser to track your
                  session. You can refer our Cookie Policy for more details.
                </p>
                <p>
                  By signing in, you agree to our Privacy Policy
                </p>
              </div>

              <div class="micado-actions">
                <input
                  type="hidden"
                  id="id-hidden-input"
                  name="credentialId"
                  <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>
                />
                <input
                  tabindex="4"
                  class="micado-submit"
                  name="login"
                  id="kc-login"
                  type="submit"
                  value="Log in"
                />
              </div>

              <#if realm.resetPasswordAllowed>
                <div class="micado-links">
                  <a href="${url.loginResetCredentialsUrl}">
                    Forgot Username or Password ?
                  </a>
                </div>
              </#if>
            </form>
          </div>
        </div>
      </div>
    </div>
  </#if>
</@layout.registrationLayout>
